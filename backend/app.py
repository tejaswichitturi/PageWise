from flask import Flask, request, jsonify
from flask_cors import CORS
from pypdf import PdfReader
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import ollama
import os
import re
import secrets
from functools import wraps
from huggingface_hub import InferenceClient
from dotenv import load_dotenv
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "pagewise.db")
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
CORS(app, origins=os.getenv("FRONTEND_ORIGIN", "*").split(","))
MODEL = os.getenv("OLLAMA_MODEL", "qwen3:4b")
CHUNK_SIZE = 5000
MAX_CONTEXT = 15000


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        pages INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        document_id INTEGER,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)
    conn.commit()
    conn.close()


def current_user():
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if not token:
        return None
    conn = db()
    row = conn.execute("""
        SELECT u.id, u.name, u.email FROM users u
        JOIN sessions s ON s.user_id = u.id
        WHERE s.token = ?
    """, (token,)).fetchone()
    conn.close()
    return dict(row) if row else None


def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"error": "Please login first."}), 401
        request.user = user
        return fn(*args, **kwargs)
    return wrapper


def clean_ai_response(text):
    if not text:
        return ""
    text = re.sub(r"<think>.*?</think>", "", str(text), flags=re.DOTALL)
    return text.strip()


def ask_ollama(prompt, max_tokens=900, retries=2):
    hf_token = os.getenv("HF_TOKEN")

    # Use Hugging Face when HF_TOKEN is configured
    if hf_token:
        try:
            client = InferenceClient(
                provider="auto",
                api_key=hf_token
            )

            response = client.chat_completion(
                model="Qwen/Qwen3-4B-Instruct-2507",
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                max_tokens=max_tokens,
                temperature=0.2,
            )

            text = response.choices[0].message.content or ""
            text = clean_ai_response(text)

            if text.strip():
                return text

        except Exception as e:
            print("Hugging Face AI error:", e)

    # Fallback to local Ollama
    for attempt in range(retries + 1):
        try:
            response = ollama.generate(
                model=MODEL,
                prompt=prompt,
                options={
                    "num_predict": max_tokens,
                    "temperature": 0.2,
                },
            )

            text = getattr(response, "response", "") or ""

            if not text and isinstance(response, dict):
                text = response.get("response", "")

            text = clean_ai_response(text)

            if text.strip():
                return text

            print(f"WARNING: Ollama returned empty response (attempt {attempt + 1})")

        except Exception as e:
            print(f"Ollama error (attempt {attempt + 1}):", e)

    return ""


def chunks_for(text):
    return [text[i:i + CHUNK_SIZE] for i in range(0, len(text), CHUNK_SIZE)]


@app.route("/")
def home():
    return jsonify({"message": "PageWise Backend is Running!", "model": MODEL})


@app.route("/api/test")
def test():
    return jsonify({"message": "PageWise API is working", "model": MODEL})


@app.post("/api/register")
def register():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    if not name or not email or len(password) < 6:
        return jsonify({"error": "Name, valid email and a password of at least 6 characters are required."}), 400
    conn = db()
    try:
        cur = conn.execute("INSERT INTO users (name,email,password_hash) VALUES (?,?,?)", (name, email, generate_password_hash(password)))
        conn.commit()
        user_id = cur.lastrowid
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "An account with this email already exists."}), 409
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO sessions (token,user_id) VALUES (?,?)", (token, user_id))
    conn.commit()
    conn.close()
    return jsonify({"token": token, "user": {"id": user_id, "name": name, "email": email}}), 201


@app.post("/api/login")
def login():
    data = request.get_json() or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    conn = db()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not check_password_hash(row["password_hash"], password):
        conn.close()
        return jsonify({"error": "Invalid email or password."}), 401
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO sessions (token,user_id) VALUES (?,?)", (token, row["id"]))
    conn.commit()
    conn.close()
    return jsonify({"token": token, "user": {"id": row["id"], "name": row["name"], "email": row["email"]}})


@app.post("/api/logout")
@auth_required
def logout():
    token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    conn = db()
    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Logged out successfully."})


@app.get("/api/me")
@auth_required
def me():
    return jsonify({"user": request.user})


@app.post("/api/upload")
@auth_required
def upload_pdf():
    if "file" not in request.files:
        return jsonify({"error": "No PDF file uploaded"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "No file selected"}), 400
    if not file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Only PDF files are allowed"}), 400
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", file.filename)
    filepath = os.path.join(UPLOAD_FOLDER, f"{request.user['id']}_{secrets.token_hex(4)}_{safe_name}")
    try:
        file.save(filepath)
        reader = PdfReader(filepath)
        extracted = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
        pages = len(reader.pages)
        if not extracted:
            return jsonify({"error": "No text could be extracted. This may be a scanned/image-only PDF."}), 400
        conn = db()
        cur = conn.execute("INSERT INTO documents (user_id,filename,pages,text) VALUES (?,?,?,?)", (request.user["id"], file.filename, pages, extracted))
        conn.commit()
        document_id = cur.lastrowid
        conn.close()
        return jsonify({"id": document_id, "filename": file.filename, "pages": pages, "text": extracted})
    except Exception as exc:
        return jsonify({"error": f"Could not read PDF: {exc}"}), 500


@app.get("/api/documents")
@auth_required
def documents():
    conn = db()
    rows = conn.execute("SELECT id,filename,pages,created_at FROM documents WHERE user_id=? ORDER BY id DESC", (request.user["id"],)).fetchall()
    conn.close()
    return jsonify({"documents": [dict(row) for row in rows]})


@app.get("/api/documents/<int:document_id>")
@auth_required
def get_document(document_id):
    conn = db()
    row = conn.execute("SELECT id,filename,pages,text,created_at FROM documents WHERE id=? AND user_id=?", (document_id, request.user["id"])).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "Document not found."}), 404
    return jsonify(dict(row))


@app.delete("/api/documents/<int:document_id>")
@auth_required
def delete_document(document_id):
    conn = db()
    conn.execute("DELETE FROM notes WHERE document_id=? AND user_id=?", (document_id, request.user["id"]))
    cur = conn.execute("DELETE FROM documents WHERE id=? AND user_id=?", (document_id, request.user["id"]))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify({"error": "Document not found."}), 404
    return jsonify({"message": "Document deleted."})


@app.post("/api/generate-notes")
@auth_required
def generate_notes():
    data = request.get_json() or {}
    text = data.get("text", "")
    document_id = data.get("document_id")
    if not text.strip():
        return jsonify({"error": "No extracted text received"}), 400
    all_notes = []
    chunks = chunks_for(text)
    print(f"Document split into {len(chunks)} chunks.")
    for index, chunk in enumerate(chunks):
        print(f"Processing chunk {index + 1}/{len(chunks)}...")
        prompt = f"""You are PageWise, an AI study assistant. Create concise, exam-focused notes from ONLY the material below. Do not invent facts. Use simple language. Include definitions, key concepts, important points, formulas, processes, examples and exam points only when present. Avoid introductions and repetition. Use Markdown headings and bullets.\n\nSTUDY MATERIAL:\n{chunk}"""
        generated = ask_ollama(prompt, 750, retries=2)
        print(f"Generated characters: {len(generated)}")
        if generated:
            all_notes.append(generated)
    final = "\n\n".join(all_notes).strip()
    if not final:
        return jsonify({"error": "AI could not generate notes. Make sure Ollama is running and the model is installed."}), 500
    if document_id:
        save_note_for_user(request.user["id"], document_id, "PageWise Notes", final)
    return jsonify({"notes": final})


@app.post("/api/ask")
@auth_required
def ask_pagewise():
    data = request.get_json() or {}
    text, question = data.get("text", ""), data.get("question", "").strip()
    if not text.strip() or not question:
        return jsonify({"error": "Study material and a question are required."}), 400
    context = text[:MAX_CONTEXT]
    prompt = f"""You are PageWise. Answer the student's question using ONLY the uploaded study material. If the answer is not present, say so. Use simple language and concise exam-friendly explanations. Do not invent facts.\n\nSTUDY MATERIAL:\n{context}\n\nQUESTION:\n{question}"""
    answer = ask_ollama(prompt, 800, retries=2)
    return jsonify({"answer": answer}) if answer else (jsonify({"error": "Could not generate an answer."}), 500)


@app.post("/api/quick-revision")
@auth_required
def quick_revision():
    data = request.get_json() or {}
    text = data.get("text", "")
    if not text.strip():
        return jsonify({"error": "No study material available."}), 400
    prompt = f"""Create a one-page quick revision sheet from ONLY this study material. Use Markdown. Include important definitions, key concepts, formulas, processes, keywords and exam points when present. Be concise and do not invent anything.\n\nMATERIAL:\n{text[:MAX_CONTEXT]}"""
    notes = ask_ollama(prompt, 1000, retries=2)
    return jsonify({"notes": notes}) if notes else (jsonify({"error": "Could not generate revision notes."}), 500)


@app.post("/api/exam-mode")
@auth_required
def exam_mode():
    data = request.get_json() or {}
    text = data.get("text", "")
    if not text.strip():
        return jsonify({"error": "No study material available."}), 400
    prompt = f"""Create exam questions from ONLY the supplied material. Use Markdown. Include 5 short questions, 5 five-mark questions, 5 ten-mark questions and a short list of important topics. Do not invent topics or facts.\n\nMATERIAL:\n{text[:MAX_CONTEXT]}"""
    questions = ask_ollama(prompt, 1000, retries=2)
    return jsonify({"questions": questions}) if questions else (jsonify({"error": "Could not generate exam questions."}), 500)


def save_note_for_user(user_id, document_id, title, content):
    conn = db()
    conn.execute("INSERT INTO notes (user_id,document_id,title,content) VALUES (?,?,?,?)", (user_id, document_id, title, content))
    conn.commit()
    conn.close()


@app.get("/api/notes")
@auth_required
def notes():
    conn = db()
    rows = conn.execute("SELECT id,document_id,title,content,updated_at FROM notes WHERE user_id=? ORDER BY id DESC", (request.user["id"],)).fetchall()
    conn.close()
    return jsonify({"notes": [dict(row) for row in rows]})


@app.post("/api/notes")
@auth_required
def create_note():
    data = request.get_json() or {}
    title = data.get("title", "Untitled Notes").strip() or "Untitled Notes"
    content = data.get("content", "").strip()
    document_id = data.get("document_id")
    if not content:
        return jsonify({"error": "Note content cannot be empty."}), 400
    conn = db()
    cur = conn.execute("INSERT INTO notes (user_id,document_id,title,content) VALUES (?,?,?,?)", (request.user["id"], document_id, title, content))
    conn.commit()
    note_id = cur.lastrowid
    conn.close()
    return jsonify({"id": note_id, "message": "Notes saved."}), 201


@app.put("/api/notes/<int:note_id>")
@auth_required
def update_note(note_id):
    data = request.get_json() or {}
    title = data.get("title", "Untitled Notes").strip() or "Untitled Notes"
    content = data.get("content", "").strip()
    conn = db()
    cur = conn.execute("UPDATE notes SET title=?,content=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?", (title, content, note_id, request.user["id"]))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify({"error": "Note not found."}), 404
    return jsonify({"message": "Notes updated."})


@app.delete("/api/notes/<int:note_id>")
@auth_required
def delete_note(note_id):
    conn = db()
    cur = conn.execute("DELETE FROM notes WHERE id=? AND user_id=?", (note_id, request.user["id"]))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify({"error": "Note not found."}), 404
    return jsonify({"message": "Note deleted."})


@app.get("/api/stats")
@auth_required
def stats():
    conn = db()
    docs = conn.execute("SELECT COUNT(*) AS c FROM documents WHERE user_id=?", (request.user["id"],)).fetchone()["c"]
    saved_notes = conn.execute("SELECT COUNT(*) AS c FROM notes WHERE user_id=?", (request.user["id"],)).fetchone()["c"]
    conn.close()
    return jsonify({"documents": docs, "notes": saved_notes})


init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
