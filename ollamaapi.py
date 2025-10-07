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
OLLAMA_API_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "gpt-oss"

# Simpan histori percakapan (per session_id)
sessions = {}

# === Fungsi pemanggil Ollama ===
def call_ollama(prompt: str):
    try:
        payload = {"model": MODEL_NAME, "prompt": prompt, "stream": False}
        response = requests.post(OLLAMA_API_URL, json=payload)
        response.raise_for_status()
        data = response.json()
        return data.get("response", "Tidak ada respons dari model.")
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
Kamu adalah **asisten pembelajaran interaktif** yang menjelaskan materi sesuai tipe kognitif pengguna.

### Informasi Pengguna:
- Profesi: {profesi}
- Usia: {umur} tahun
- Tipe Belajar Utama: {tipe_kognitif}

### Pertanyaan Pengguna:
"{pertanyaan}"

### Instruksi:
1. Gunakan bahasa sederhana, jelas, dan ramah sehingga bisa dipahami oleh semua orang.
2. Sesuaikan kedalaman materi, pilihan kata, dan nada penjelasan dengan usia pengguna:
   - **≤ 12 tahun (SD)** → jelaskan seperti ngobrol dengan anak SD; gunakan cerita sehari-hari, contoh konkret, dan hindari istilah rumit.
   - **13–18 tahun (SMP/SMA)** → jelaskan dengan gaya remaja; gunakan contoh yang relevan dengan sekolah dan aktivitas hobi.
   - **19–40 tahun** → gunakan gaya profesional santai; hubungkan materi dengan pengembangan diri, studi, atau pekerjaan awal.
   - **41–60 tahun** → gunakan gaya sopan dan menghargai pengalaman kerja; tekankan manfaat praktis dan penerapan di pekerjaan atau keluarga.
   - **> 60 tahun** → gunakan gaya penuh empati dengan tempo penjelasan perlahan dan contoh keseharian yang familiar.
3. Kaitkan penjelasan langsung dengan profesi pengguna: jelaskan relevansi materi terhadap tugas, tantangan, istilah kerja, atau perkembangan kariernya. Jika profesi kurang spesifik, beri contoh yang masih serumpun.
4. Hubungkan contoh atau analogi dengan aktivitas umum dalam kehidupan sehari-hari sesuai usia agar tetap mudah dibayangkan.
5. Sesuaikan gaya penjelasan dengan tipe kognitif:
   - **Visual** → gunakan deskripsi gambar, diagram, atau peta konsep.
   - **Auditori** → gunakan gaya bercerita, analogi suara, atau percakapan.
   - **Kinestetik** → gunakan contoh praktik, gerakan, atau eksperimen langsung.
6. Jelaskan istilah teknis jika muncul dan beri alternatif kata yang lebih mudah.
7. Sertakan poin penting dalam bullet agar lebih terstruktur.
8. Jangan menjawab terlalu panjang, cukup ringkas tapi bermakna.
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
Kamu adalah **evaluator pembelajaran**.

### Pertanyaan:
"{pertanyaan}"

### Jawaban Pengguna:
"{jawaban_user}"

### Instruksi:
1. Tentukan apakah jawaban pengguna **BENAR** atau **SALAH** berdasarkan substansi (abaikan beda phrasing).
2. Jika **BENAR**:
   - Beri apresiasi singkat.
   - Nyatakan bahwa pengguna sudah memahami konsep.
3. Jika **SALAH**:
   - Berikan koreksi singkat.
   - Tambahkan **hint atau pertanyaan lanjutan** agar pengguna bisa mencoba lagi.
4. Output harus dalam format JSON valid berikut:

{{
  "correct": true/false,
  "feedback": "penjelasan singkat",
  "next_question": "pertanyaan lanjutan atau hint jika salah, kosong jika benar"
}}
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