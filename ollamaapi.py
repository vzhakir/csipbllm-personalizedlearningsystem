from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import PlainTextResponse, JSONResponse
import requests, json, uuid

app = FastAPI()

# Middleware CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ollama API
OLLAMA_API_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "gpt-oss"

# Session storage
sessions = {}

def call_ollama(prompt: str):
    try:
        payload = {"model": MODEL_NAME, "prompt": prompt, "stream": False}
        response = requests.post(OLLAMA_API_URL, json=payload)
        response.raise_for_status()
        return response.json().get("response", "Tidak ada respons dari model.")
    except Exception as e:
        return f"❌ Error memanggil model: {str(e)}"


@app.post("/chat")
async def chat(
    profesi: str = Form(...),
    umur: int = Form(...),
    tipe_kognitif: str = Form(...),
    pertanyaan: str = Form(...),
    session_id: str = Form(None),
):
    # Buat session baru jika belum ada
    if not session_id:
        session_id = str(uuid.uuid4())
        sessions[session_id] = []

    if session_id not in sessions:
        sessions[session_id] = []

    # Tambahkan pertanyaan user
    sessions[session_id].append({"role": "user", "content": pertanyaan})

    # Buat prompt dengan histori
    history_text = "\n".join(
        [f"{msg['role'].capitalize()}: {msg['content']}" for msg in sessions[session_id]]
    )

    prompt = f"""
Kamu adalah asisten pembelajaran interaktif.
Profil pengguna:
- Profesi: {profesi}
- Umur: {umur}
- Tipe kognitif belajar: {tipe_kognitif}

Riwayat percakapan sejauh ini:
{history_text}

Instruksi:
- Berikan respon yang sesuai dengan gaya belajar {tipe_kognitif}.
- Jika user salah, beri petunjuk tambahan atau analogi lain.
- Jika user sudah benar, validasi lalu tambahkan pengayaan.
- Jangan gunakan format stage kaku, cukup respon alami dan bertahap.
"""

    answer = call_ollama(prompt)

    # Simpan jawaban asisten
    sessions[session_id].append({"role": "assistant", "content": answer})

    return {"answer": answer, "session_id": session_id}


@app.get("/download_history")
async def download_history(session_id: str, format: str = "txt"):
    if session_id not in sessions or not sessions[session_id]:
        return PlainTextResponse("❌ Tidak ada histori untuk session ini.", media_type="text/plain")

    if format == "json":
        return JSONResponse(
            content=sessions[session_id],
            headers={"Content-Disposition": f"attachment; filename=history_{session_id}.json"}
        )

    history_text = "\n".join(
        [f"{msg['role'].capitalize()}: {msg['content']}" for msg in sessions[session_id]]
    )
    return PlainTextResponse(
        history_text,
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=history_{session_id}.txt"}
    )


# Mount static folder
app.mount("/", StaticFiles(directory="static", html=True), name="static")
