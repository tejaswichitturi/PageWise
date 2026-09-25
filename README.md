# PageWise

PageWise is a responsive AI study assistant that turns PDF study material into notes, quick revision sheets and exam questions, and lets students ask questions from their uploaded material.

## Features
- Responsive React + Vite interface for phones, tablets and laptops
- Flask REST API
- PDF page counting and text extraction with pypdf
- Local AI with Ollama + Qwen3 4B
- Smart Notes with retry handling for empty AI responses
- Ask PageWise
- Quick Revision
- Exam Mode
- Editable notes
- Save notes to SQLite
- Extracted-text download
- User registration/login/logout
- My Documents, My Notes and Progress

## Project structure

```text
PageWise/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── .gitignore
│   └── uploads/
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── .gitignore
└── README.md
```

## Local setup

### 1. Ollama
Install Ollama and make sure the model is available:

```bash
ollama pull qwen3:4b
ollama serve
```

### 2. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Backend: `http://127.0.0.1:5000`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:5173`

## Production / live deployment

The React frontend can be deployed to a static host and the Flask API to a Python host. However, the default AI provider is local Ollama, so a public deployment needs a server/VPS capable of running Ollama and the Qwen3 4B model, or the backend must be adapted to a hosted AI provider. A normal static frontend deployment alone cannot run Ollama on a user's phone/laptop.

Set `VITE_API_URL` in the frontend build environment to the public Flask API URL. Set `FRONTEND_ORIGIN` in the backend environment to the deployed frontend origin.

## Privacy model

In the local setup, PDF text is processed by the local Flask server and local Ollama model rather than a third-party AI API. This is the recommended development/demo mode for the project.

## Resume description

**PageWise — AI Study Assistant:** Built a responsive full-stack study platform using React, Flask, SQLite and Ollama/Qwen3 4B that extracts PDF content, generates exam-focused notes, answers context-based questions, creates revision sheets and exam questions, and supports authenticated document/note management.
