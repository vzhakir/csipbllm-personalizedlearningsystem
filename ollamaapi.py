from fastapi import FastAPI, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
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

# Konfigurasi Ollama
OLLAMA_API_URL = "http://localhost:11435/api/generate"
MODEL_NAME = "deepseek-r1:8b"

# Simpan histori percakapan (per session_id)
sessions = {}

# === Fungsi pemanggil Ollama ===
def call_ollama(prompt: str):
    try:
        payload = {"model": MODEL_NAME, "prompt": prompt, "stream": False}
        response = requests.post(OLLAMA_API_URL, json=payload)
        response.raise_for_status()
        data = response.json()
        raw_output = data.get("response", "Tidak ada respons dari model.")

        # --- Filter "thinking" otomatis ---
        clean_output = raw_output
        lower = raw_output.lower()
        if "let's think" in lower or "thinking:" in lower or "<think>" in lower:
            # hilangkan bagian reasoning
            parts = raw_output.split("\n")
            filtered = []
            skip = False
            for line in parts:
                if any(keyword in line.lower() for keyword in ["think", "reason", "analysis", "<think>"]):
                    skip = True
                elif skip and line.strip() == "":
                    continue
                else:
                    filtered.append(line)
            clean_output = "\n".join(filtered).strip()

        return clean_output or raw_output

    except Exception as e:
        return f"❌ Error: {str(e)}"

# === Endpoint Tanya ===
@app.post("/ask")
async def ask(
    profesi: str = Form(...),
    umur: int = Form(...),
    tipe_kognitif: str = Form(...),
    pertanyaan: str = Form(...),
    session_id: str = Form(None)
):
    if not session_id:
        session_id = str(uuid.uuid4())
        sessions[session_id] = []

    prompt = f"""
    Kamu adalah asisten belajar yang sabar dan komunikatif.
    Tugasmu membantu pengguna memahami konsep sesuai tipe belajar utamanya.

    Data pengguna:
    Profesi: {profesi}
    Umur: {umur}
    Tipe belajar: {tipe_kognitif}

    Pertanyaan:
    {pertanyaan}

    Berikan dua bagian dalam jawaban:
    1. Penjelasan utama yang sesuai dengan tipe belajar {tipe_kognitif}.
    2. Perbandingan singkat dengan salah satu tipe belajar lain yang berbeda (visual, auditori, atau kinestetik, pilih secara acak).

    Gunakan bahasa sederhana dan langsung pada inti pembahasan.
    Jelaskan dengan cara alami, seperti menjelaskan ke teman.
    Tidak perlu menggunakan bullet, penomoran, emoji, atau gaya penulisan khusus.
    Akhiri jawaban dengan satu pertanyaan singkat agar pengguna bisa mencoba berpikir atau menjawab.
    """


    answer = call_ollama(prompt)

    # Simpan histori
    sessions[session_id].append({"pertanyaan": pertanyaan, "jawaban": answer})

    return {"session_id": session_id, "answer": answer}

# === Endpoint Validasi Jawaban ===
@app.post("/check_answer")
async def check_answer(
    profesi: str = Form(...),
    umur: int = Form(...),
    tipe_kognitif: str = Form(...),
    pertanyaan: str = Form(...),
    jawaban_user: str = Form(...),
    session_id: str = Form(None)
):
    if not session_id:
        session_id = str(uuid.uuid4())
        sessions[session_id] = []

    prompt = f"""
    Kamu adalah evaluator pembelajaran yang ramah dan jelas.

    Pertanyaan:
    {pertanyaan}

    Jawaban pengguna:
    {jawaban_user}

    Tugasmu:
    1. Tentukan apakah jawaban pengguna benar atau salah berdasarkan makna.
    2. Jika benar, beri pujian singkat dan jelaskan alasan singkat mengapa benar.
    3. Jika salah, jelaskan secara singkat bagian yang kurang tepat dan berikan pertanyaan lanjutan agar pengguna bisa berpikir lagi.
    4. Jawab hanya dalam format JSON valid seperti ini:

    {{"correct": true/false, "feedback": "penjelasan singkat", "next_question": "pertanyaan lanjutan atau kosong jika benar"}}
    """

    result = call_ollama(prompt).strip()

    try:
        data = json.loads(result)
    except:
        data = {
            "correct": False,
            "feedback": f"⚠️ Format tidak valid. Respons: {result}",
            "next_question": ""
        }

    # Simpan histori evaluasi
    sessions[session_id].append({
        "pertanyaan": pertanyaan,
        "jawaban_user": jawaban_user,
        "evaluasi": data
    })

    return {"session_id": session_id, **data}

# === Endpoint Download Histori ===
@app.get("/download_history")
async def download_history(session_id: str, format: str = "txt"):
    if session_id not in sessions:
        return {"error": "Session not found"}
    history = sessions[session_id]

    if format == "json":
        return history

    txt = ""
    for h in history:
        txt += f"Q: {h.get('pertanyaan')}\n"
        if "jawaban" in h:
            txt += f"A: {h['jawaban']}\n"
        if "jawaban_user" in h:
            txt += f"User: {h['jawaban_user']}\n"
            txt += f"Evaluasi: {h['evaluasi']}\n"
        txt += "\n"
    return txt

# === Serve frontend ===
app.mount("/", StaticFiles(directory="static", html=True), name="static")