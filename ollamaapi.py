# ================================================================
#  CSIPBLLM PERSONALIZED LEARNING SYSTEM — BACKEND (OLLAMA GPT-OSS)
# ================================================================
# Versi: 2025-10-17 (Final — Follow-up Question + Adaptive Hints + CT)
# ------------------------------------------------
#  ⚙️  Fitur:
#   ✅ Mode perbandingan otomatis antar gaya belajar
#   ✅ Evaluasi jawaban siswa (adaptive hint, tanpa membocorkan jawaban)
#   ✅ Follow-up question di /chat & /evaluate
#   ✅ Code-friendly (Computational Thinking) untuk pertanyaan & jawaban
#   ✅ Riwayat percakapan + download (txt/json)
#   ✅ Deteksi otomatis port Ollama (11435/11434)
#   ✅ Hanya 3 gaya belajar: Visual, Auditori, Kinestetik
# ================================================================

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional
import requests
import json
import random
import os
import time
import re

# ================================================================
# KONFIGURASI DASAR FASTAPI
# ================================================================

app = FastAPI(title="Manual Self-Learning AI - Stable")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse({"error": "index.html tidak ditemukan"}, status_code=404)

# ================================================================
# KONFIGURASI SERVER OLLAMA
# ================================================================

OLLAMA_PORTS = [11435, 11434]
MODEL_NAME = "deepseek-r1:8b"
OLLAMA_API_URL = None

for port in OLLAMA_PORTS:
    try:
        r = requests.get(f"http://localhost:{port}", timeout=2)
        if r.status_code in (200, 404):
            OLLAMA_API_URL = f"http://localhost:{port}/api/generate"
            print(f"[SYSTEM] ✅ Ollama ditemukan di port {port}")
            break
    except Exception:
        continue

if not OLLAMA_API_URL:
    print("[SYSTEM] ⚠️ Tidak menemukan Ollama di port 11435 atau 11434.")
    print("Pastikan jalankan perintah: ollama serve")
    OLLAMA_API_URL = "http://localhost:11434/api/generate"

# ================================================================
# PENYIMPANAN RIWAYAT PERCAPAKAN
# ================================================================

conversation_history: List[Dict] = []

# ================================================================
# MODEL DATA
# ================================================================

class ChatRequest(BaseModel):
    message: str
    style: str = "visual"   # default tetap visual agar tidak null

class EvalRequest(BaseModel):
    answer: str
    correct_answer: str
    wrong_count: Optional[int] = 0  # jumlah salah sebelumnya (opsional)

# ================================================================
# FUNGSI KONEKSI KE OLLAMA
# ================================================================

def query_ollama(prompt: str, retries: int = 3, delay: int = 5) -> str:
    """
    Kirim prompt ke model Ollama GPT-OSS & kembalikan teks hasil.
    Termasuk retry otomatis jika model belum siap.
    """
    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": False
    }

    for attempt in range(retries):
        try:
            print(f"[OllamaAPI] 🚀 Kirim prompt ke {MODEL_NAME} (Percobaan {attempt + 1}/{retries})")
            response = requests.post(OLLAMA_API_URL, json=payload, timeout=1500)

            if response.status_code == 200:
                try:
                    data = response.json()
                    text = data.get("response", "").strip()
                    if text:
                        print("[OllamaAPI] ✅ Respons berhasil diterima dari Ollama.")
                        return text
                    else:
                        print("[OllamaAPI] ⚠️ Respons kosong dari model.")
                        return "[Error] Model tidak mengembalikan jawaban."
                except json.JSONDecodeError:
                    return "[Error] Format respons JSON tidak valid."

            elif response.status_code == 500:
                print("[OllamaAPI] ⚠️ Server Ollama belum siap, retry dalam 5 detik...")
                time.sleep(delay)
                continue
            else:
                print(f"[OllamaAPI] ⚠️ HTTP {response.status_code} — {response.text[:200]}")
                return f"[Error Ollama API] {response.text[:200]}"

        except requests.exceptions.ConnectionError:
            print("[OllamaAPI] ❌ Tidak dapat terhubung ke server Ollama.")
            time.sleep(delay)
        except requests.exceptions.ReadTimeout:
            print("[OllamaAPI] ⏱️ Timeout: Ollama tidak merespons dalam 300 detik.")
            return "[Error Ollama API] Timeout (300 detik)"
        except Exception as e:
            print(f"[OllamaAPI] ❌ Exception: {e}")
            time.sleep(delay)

    return "[Error Ollama API] Tidak bisa terhubung ke Ollama setelah beberapa percobaan."

# ================================================================
# UTIL: DETEKSI PERTANYAAN/KODE (CT-FRIENDLY)
# ================================================================

CODE_REGEX = re.compile(r"```[\s\S]*?```|(\bfor\b|\bwhile\b|\bif\b|\bdef\b|\bprint\b|\breturn\b|;|=)")

def is_code_like(text: str) -> bool:
    return bool(CODE_REGEX.search(text or ""))

# ================================================================
# ENDPOINT CHAT (dengan Follow-up Question)
# ================================================================

@app.post("/chat")
def chat_endpoint(req: ChatRequest):
    """
    Endpoint utama untuk percakapan:
    - Menerima pertanyaan user (termasuk code-friendly)
    - Menghasilkan 2 gaya jawaban (utama + perbandingan)
    - Menambahkan pertanyaan lanjutan otomatis (follow-up teaching question)
    """
    all_styles = ["visual", "auditori", "kinestetik"]
    style_main = req.style.lower()
    if style_main not in all_styles:
        style_main = "visual"
    style_compare = random.choice([s for s in all_styles if s != style_main])

    print("\n==============================")
    print(f"[CHAT] Pertanyaan: {req.message}")
    print(f"[CHAT] Gaya utama: {style_main}")
    print(f"[CHAT] Gaya perbandingan: {style_compare}")
    print("==============================")

    # Deteksi pertanyaan code-friendly
    code_question = is_code_like(req.message)

    # Prompt utama
    if code_question:
        prompt_main = (
            f"Kamu adalah tutor Computational Thinking bergaya '{style_main}'. "
            f"Analisis pertanyaan pengguna yang berkaitan dengan logika algoritma/kode berikut:\n\n"
            f"{req.message}\n\n"
            f"Berikan penjelasan yang menekankan pemahaman konsep, logika, dan langkah berpikir "
            f"sesuai gaya '{style_main}'. Gunakan bahasa Indonesia yang mudah dipahami."
        )
        prompt_compare = (
            f"Buat versi penjelasan lain untuk pertanyaan logika/kode di atas "
            f"dengan gaya belajar '{style_compare}'. Fokus pada pola pikir komputasional."
        )
    else:
        prompt_main = (
            f"Kamu adalah tutor dengan gaya belajar '{style_main}'. "
            f"Berikan penjelasan mudah dipahami, terstruktur, dan ringkas untuk pertanyaan berikut:\n\n"
            f"{req.message}\n\n"
            f"Tulis dalam gaya belajar '{style_main}'."
        )
        prompt_compare = (
            f"Buat versi jawaban lain dengan gaya '{style_compare}' untuk perbandingan dengan gaya '{style_main}'. "
            f"Pertanyaannya sama:\n\n{req.message}\n\n"
            f"Tulis dengan bahasa Indonesia sesuai gaya '{style_compare}'."
        )

    # Kirim ke model
    reply_main = query_ollama(prompt_main)
    reply_compare = query_ollama(prompt_compare)

    # Follow-up question langsung setelah jawaban pertama
    followup_prompt = (
        f"Kamu adalah tutor interaktif. Berdasarkan jawaban penjelasan berikut:\n\n"
        f"{reply_main}\n\n"
        f"Buat SATU pertanyaan lanjutan (tepat 1 kalimat) untuk mengajak siswa berpikir lebih dalam. "
        f"Hindari memberi jawaban; fokus pada konsep atau aplikasi."
    )
    followup_question = query_ollama(followup_prompt).strip()

    # Simpan riwayat
    conversation_entry = {
        "user_message": req.message,
        "style_main": style_main,
        "reply_main": reply_main,
        "style_compare": style_compare,
        "reply_compare": reply_compare,
        "followup_question": followup_question,
        "is_code_question": code_question,
    }
    conversation_history.append(conversation_entry)

    print(f"[CHAT] 💾 Riwayat disimpan (total {len(conversation_history)} percakapan).")

    return {
        "style_main": style_main,
        "reply_main": reply_main,
        "style_compare": style_compare,
        "reply_compare": reply_compare,
        "followup_question": followup_question,
        "is_code_question": code_question,
    }

# ================================================================
# ENDPOINT EVALUASI JAWABAN (Adaptive Hint + Follow-up)
# ================================================================

@app.post("/evaluate")
def evaluate_answer(req: EvalRequest):
    """
    Mengevaluasi jawaban siswa berbasis teks & code-friendly (Computational Thinking),
    dengan adaptive scaffolding dan pertanyaan lanjutan. Tidak membocorkan jawaban.
    """
    print("[EVALUASI] 🧠 Mode evaluasi adaptif + code-friendly aktif")

    wrong_count = req.wrong_count or 0
    answer = (req.answer or "").strip()
    is_code = is_code_like(answer)

    # Tahap scaffolding
    if wrong_count == 0:
        hint_level = "Evaluasi awal."
        followup_role = "ajukan 1 pertanyaan sederhana untuk menguji pemahaman dasar."
    elif wrong_count == 1:
        hint_level = "Directive Hint: petunjuk singkat & spesifik."
        followup_role = "ajukan 1 pertanyaan penuntun yang mengarah pada inti konsep."
    elif wrong_count == 2:
        hint_level = "Remedial Scaffold: contoh sepadan + langkah kecil."
        followup_role = "ajukan pertanyaan lanjutan berbasis analogi atau langkah kecil."
    else:
        hint_level = "Facilitative Step-by-Step Guide: panduan penuh (tanpa jawaban final)."
        followup_role = "ajukan pertanyaan reflektif agar siswa menyusun kembali pemahamannya."

    # Prompt evaluasi
    if is_code:
        prompt_eval = (
            f"Kamu adalah tutor Computational Thinking. "
            f"Evaluasi logika, struktur, dan kejelasan kode/pseudocode berikut.\n\n"
            f"Jawaban siswa:\n{req.answer}\n\n"
            f"Kunci jawaban (rujukan konsep):\n{req.correct_answer}\n\n"
            f"Tahap: {hint_level}\n"
            f"Berikan umpan balik ringkas, fokus ke algoritma & urutan langkah, bukan sekadar sintaks. "
            f"Jika salah, JANGAN berikan jawaban final — beri petunjuk bertahap."
        )
    else:
        prompt_eval = (
            f"Kamu adalah tutor adaptif. Evaluasi jawaban siswa berdasarkan kunci jawaban berikut.\n\n"
            f"Jawaban siswa:\n{req.answer}\n\n"
            f"Kunci jawaban:\n{req.correct_answer}\n\n"
            f"Tahap: {hint_level}\n"
            f"Berikan umpan balik yang mendidik dan petunjuk bertahap. Jangan bocorkan jawaban final jika salah."
        )

    feedback = query_ollama(prompt_eval)
    # Heuristik sederhana (tetap kompatibel)
    is_correct_flag = "benar" in feedback.lower() and "salah" not in feedback.lower()

    # Pertanyaan lanjutan adaptif (selalu dibuat agar loop belajar berlanjut)
    followup_prompt = (
        f"Kamu adalah tutor interaktif. Berdasarkan jawaban siswa & kunci konsep:\n\n"
        f"Jawaban siswa:\n{req.answer}\n\n"
        f"Kunci konsep:\n{req.correct_answer}\n\n"
        f"Pada tahap: {hint_level}, {followup_role} "
        f"Tepat 1 kalimat. Jangan berikan jawaban langsung."
    )
    followup_question = query_ollama(followup_prompt).strip()

    return {
        "is_correct": is_correct_flag,
        "feedback": feedback.strip(),
        "hint_level": hint_level,
        "is_code": is_code,
        "followup_question": followup_question,
    }

# ================================================================
# ENDPOINT RIWAYAT PERCAPAKAN
# ================================================================

@app.get("/history")
def get_history(format: str = "json"):
    """
    Mengambil seluruh riwayat percakapan
    dalam format JSON atau teks biasa.
    """
    if not conversation_history:
        if format == "json":
            return {"history": []}
        return {"data": "Belum ada percakapan."}

    if format == "json":
        return {"history": conversation_history}

    # Format teks (untuk txt atau selain 'json')
    text_data = ""
    for i, conv in enumerate(conversation_history, start=1):
        text_data += f"[Percakapan {i}]\n"
        text_data += f"Pertanyaan: {conv['user_message']}\n"
        text_data += f"Jawaban ({conv['style_main']}): {conv['reply_main']}\n"
        text_data += f"Perbandingan ({conv['style_compare']}): {conv['reply_compare']}\n"
        if conv.get("followup_question"):
            text_data += f"Pertanyaan Lanjutan: {conv['followup_question']}\n"
        text_data += "-" * 60 + "\n"
    return {"data": text_data}

# ================================================================
# MAIN ENTRYPOINT SERVER
# ================================================================

if __name__ == "__main__":
    import uvicorn

    print("\n🚀 Menjalankan server CSIPBLLM di http://127.0.0.1:8000")
    print(f"🔌 Endpoint Ollama: {OLLAMA_API_URL}")
    print("💡 Model: gpt-oss | Gaya Belajar: Visual, Auditori, Kinestetik")
    uvicorn.run("ollamaapi:app", host="127.0.0.1", port=8000, reload=True)
