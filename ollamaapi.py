# ================================================================
#  CSIPBLLM PERSONALIZED LEARNING SYSTEM — BACKEND (OLLAMA GPT-OSS)
# ================================================================
# Versi: 2025-10-10 (Final Verbose, 3 gaya belajar)
# ------------------------------------------------
#  ⚙️  Fitur:
#   ✅ Mode perbandingan otomatis antar gaya belajar
#   ✅ Evaluasi jawaban siswa
#   ✅ Riwayat percakapan + download (txt/json)
#   ✅ Deteksi otomatis port Ollama (11435/11434)
#   ✅ Hanya 3 gaya belajar: Visual, Auditori, Kinestetik
# ================================================================

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict
import requests
import json
import random
import os
import time

# ================================================================
# KONFIGURASI DASAR FASTAPI
# ================================================================

app = FastAPI(title="CSIPBLLM Personalized Learning System")

# Lokasi folder frontend (static)
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def serve_index():
    """Menampilkan halaman utama index.html"""
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse({"error": "index.html tidak ditemukan"}, status_code=404)

# ================================================================
# KONFIGURASI SERVER OLLAMA
# ================================================================

OLLAMA_PORTS = [11435, 11434]
MODEL_NAME = "gpt-oss"
OLLAMA_API_URL = None

# Deteksi port aktif Ollama
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

# ================================================================
# FUNGSI KONEKSI KE OLLAMA
# ================================================================

def query_ollama(prompt: str, retries: int = 3, delay: int = 5) -> str:
    """
    Mengirim prompt ke model Ollama GPT-OSS
    dan mengembalikan hasil teks yang sudah diproses.
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
            response = requests.post(OLLAMA_API_URL, json=payload, timeout=300)

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
# ENDPOINT CHAT
# ================================================================

@app.post("/chat")
def chat_endpoint(req: ChatRequest):
    """
    Endpoint utama untuk percakapan:
    - Menerima pertanyaan user
    - Menghasilkan 2 gaya jawaban (utama + perbandingan)
    """
    # Hanya 3 gaya belajar
    all_styles = ["visual", "auditori", "kinestetik"]

    # Pastikan input gaya valid
    style_main = req.style.lower()
    if style_main not in all_styles:
        style_main = "visual"

    # Gaya perbandingan diambil acak dari dua lainnya
    style_compare = random.choice([s for s in all_styles if s != style_main])

    print("\n==============================")
    print(f"[CHAT] Pertanyaan: {req.message}")
    print(f"[CHAT] Gaya utama: {style_main}")
    print(f"[CHAT] Gaya perbandingan: {style_compare}")
    print("==============================")

    # Prompt utama
    prompt_main = (
        f"Kamu adalah tutor dengan gaya belajar '{style_main}'. "
        f"Berikan penjelasan mudah dipahami, terstruktur, dan ringkas untuk pertanyaan berikut:\n\n"
        f"{req.message}\n\n"
        f"Tulis dalam gaya belajar '{style_main}' agar cocok untuk tipe siswa tersebut."
    )

    # Prompt perbandingan
    prompt_compare = (
        f"Buat versi jawaban lain dengan gaya belajar '{style_compare}', "
        f"untuk perbandingan dengan gaya '{style_main}'. "
        f"Pertanyaannya sama:\n\n{req.message}\n\n"
        f"Tulis dengan bahasa Indonesia sesuai gaya '{style_compare}'."
    )

    # Kirim ke model
    reply_main = query_ollama(prompt_main)
    reply_compare = query_ollama(prompt_compare)

    # Simpan ke riwayat percakapan
    conversation_entry = {
        "user_message": req.message,
        "style_main": style_main,
        "reply_main": reply_main,
        "style_compare": style_compare,
        "reply_compare": reply_compare,
    }
    conversation_history.append(conversation_entry)

    print(f"[CHAT] 💾 Riwayat disimpan (total {len(conversation_history)} percakapan).")

    return {
        "style_main": style_main,
        "reply_main": reply_main,
        "style_compare": style_compare,
        "reply_compare": reply_compare,
    }

# ================================================================
# ENDPOINT EVALUASI JAWABAN
# ================================================================

@app.post("/evaluate")
def evaluate_answer(req: EvalRequest):
    """
    Mengevaluasi jawaban siswa berdasarkan kunci jawaban model.
    Mengembalikan feedback & status benar/salah.
    """
    print("[EVALUASI] 🧠 Menilai jawaban siswa...")

    prompt_eval = (
        f"Evaluasi jawaban siswa berikut:\n\n"
        f"Jawaban siswa: {req.answer}\n\n"
        f"Kunci jawaban: {req.correct_answer}\n\n"
        f"Tentukan apakah jawaban siswa benar atau salah, "
        f"dan berikan alasan singkat dalam bahasa Indonesia."
    )

    feedback = query_ollama(prompt_eval)
    is_correct = "benar" in feedback.lower() and "salah" not in feedback.lower()

    return {
        "is_correct": is_correct,
        "feedback": feedback.strip(),
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
        return {"data": "Belum ada percakapan."}

    if format == "json":
        return {"history": conversation_history}

    # Format teks
    text_data = ""
    for i, conv in enumerate(conversation_history, start=1):
        text_data += f"[Percakapan {i}]\n"
        text_data += f"Pertanyaan: {conv['user_message']}\n"
        text_data += f"Jawaban ({conv['style_main']}): {conv['reply_main']}\n"
        text_data += f"Perbandingan ({conv['style_compare']}): {conv['reply_compare']}\n"
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
