# Deployment checklist

## Frontend
1. Run `npm install`.
2. Set `VITE_API_URL` to the public Flask API URL.
3. Run `npm run build`.
4. Deploy the `dist` folder to a static hosting provider.

## Backend + local AI
For the full Qwen3 4B local-AI experience, use a VPS/server with enough RAM/compute for Ollama. Start Ollama, pull `qwen3:4b`, then run Flask behind a production WSGI server such as Gunicorn.

Example:

```bash
ollama pull qwen3:4b
gunicorn -w 2 -b 0.0.0.0:5000 app:app
```

Set:

```text
OLLAMA_MODEL=qwen3:4b
FRONTEND_ORIGIN=https://your-frontend-domain.example
```

Do not use Flask's development server in production.
