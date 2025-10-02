from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import PlainTextResponse, JSONResponse
import requests, json, uuid

app = FastAPI()

# Izinkan akses dari frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Konfigurasi model Ollama
OLLAMA_API_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "gpt-oss"

# Simpan histori percakapan
sessions = {}  # {session_id: [{"role": "user"/"assistant", "content": "..."}]}


def call_ollama(prompt: str):
    try:
        payload = {"model": MODEL_NAME, "prompt": prompt, "stream": False}
        response = requests.post(OLLAMA_API_URL, json=payload)
        response.raise_for_status()
        data = response.json()
        return data.get("response", "Tidak ada respons dari model.")
    except Exception as e:
        return f"❌ Terjadi kesalahan saat memanggil model: {str(e)}"


# Endpoint generik untuk tahap berapapun
@app.post("/ask_stage")
async def ask_stage(
    profesi: str = Form(...),
    umur: int = Form(...),
    tipe_kognitif: str = Form(...),
    pertanyaan: str = Form(...),
    stage: int = Form(...),
    session_id: str = Form(None),
):
    # buat session id baru kalau belum ada
    if not session_id:
        session_id = str(uuid.uuid4())
        sessions[session_id] = []

    if session_id not in sessions:
        sessions[session_id] = []

    # simpan pertanyaan user
    sessions[session_id].append({"role": "user", "content": pertanyaan})

    if stage == 1:
        instruksi = "Tahap 1 — Hint Umum. Berikan petunjuk ringan agar pengguna berpikir sendiri, jangan langsung memberi jawaban."
    elif stage == 2:
        instruksi = "Tahap 2 — Hint Visual. Gunakan analogi atau deskripsi visual yang membantu, jangan langsung memberi jawaban."
    elif stage == 3:
        instruksi = "Tahap 3 — Jawaban Lengkap. Jawaban harus benar, lengkap, mudah dimengerti."
    else:
        instruksi = f"Tahap {stage} — Penjelasan Lanjutan. Tambahkan detail tambahan, contoh, atau perspektif lain agar semakin jelas."

    # gabungkan histori
    history_text = "\n".join(
        [f"{msg['role'].capitalize()}: {msg['content']}" for msg in sessions[session_id]]
    )

    prompt = f"""
Kamu adalah asisten pembelajaran.
Profil pengguna:
- Profesi: {profesi}
- Umur: {umur}
- Tipe kognitif belajar: {tipe_kognitif}

Riwayat percakapan:
{history_text}

Instruksi:
{instruksi}
"""

    answer = call_ollama(prompt)

    # simpan jawaban asisten
    sessions[session_id].append({"role": "assistant", "content": answer})

    return {"tahap": f"Tahap {stage}", "answer": answer, "session_id": session_id}


# Evaluasi jawaban
@app.post("/check_answer")
async def check_answer(
    profesi: str = Form(...),
    umur: int = Form(...),
    tipe_kognitif: str = Form(...),
    pertanyaan: str = Form(...),
    jawaban_user: str = Form(...),
    session_id: str = Form(None),
):
    if not session_id:
        session_id = str(uuid.uuid4())
        sessions[session_id] = []

    if session_id not in sessions:
        sessions[session_id] = []

    sessions[session_id].append({"role": "user", "content": jawaban_user})

    prompt = f"""
Kamu adalah evaluator jawaban.

Pertanyaan: "{pertanyaan}"
Jawaban pengguna: "{jawaban_user}"

Tugas:
1. Analisis apakah makna jawaban sudah tepat.
2. Abaikan phrasing atau susunan kata yang berbeda.
3. Fokus ke substansi dan pemahaman.
4. Jawab dalam format JSON valid saja. Tanpa penjelasan lain.

Format:
{{
  "correct": true/false,
  "feedback": "penjelasan singkat"
}}
"""
    result = call_ollama(prompt).strip()
    try:
        data = json.loads(result)
    except:
        data = {"correct": False, "feedback": f"⚠️ Format tidak valid. Respons: {result}"}

    sessions[session_id].append(
        {"role": "assistant", "content": f"Evaluasi: {json.dumps(data)}"}
    )

    return {**data, "session_id": session_id}


# Endpoint download history
@app.get("/download_history")
async def download_history(session_id: str, format: str = "txt"):
    if session_id not in sessions or not sessions[session_id]:
        return PlainTextResponse("❌ Tidak ada histori untuk session ini.", media_type="text/plain")

    if format == "json":
        return JSONResponse(
            content=sessions[session_id],
            headers={"Content-Disposition": f"attachment; filename=history_{session_id}.json"}
        )

    # default: txt
    history_text = "\n".join(
        [f"{msg['role'].capitalize()}: {msg['content']}" for msg in sessions[session_id]]
    )
    return PlainTextResponse(
        history_text,
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=history_{session_id}.txt"}
    )


# Mount folder static
app.mount("/", StaticFiles(directory="static", html=True), name="static")