# =============================================================================
# CSIPBLLM Personalized Learning — Backend API (Ultra Extended)
# -----------------------------------------------------------------------------
#  Fitur Utama:
#   ✅ /api/generate         → single-shot chat sesuai konteks (+ dual cognitive compare + follow-up check)
#   ✅ /chat                 → jawaban + perbandingan gaya + follow-up (FIX FastAPI)
#   ✅ /chat_stream          → streaming (NDJSON proxy → text/plain)
#   ✅ /recommend            → rekomendasi belajar per gaya
#   ✅ /evaluate             → evaluasi adaptif (4 tahap hint)
#   ✅ /comprehension_check  → loop cek pemahaman (stop jika “mengerti”)
#   ✅ /api/models           → daftar model Ollama
#   ✅ /api/set_model        → ganti model aktif
#   ✅ /api/status           → health check & versi ollama
#   ✅ /api/history          → gabungan memori + file
#   ✅ /api/history/clear    → hapus semua riwayat
#   ✅ /api/history/export   → export riwayat (JSON / text)
#   ✅ /api/history/import   → import riwayat (JSON)
#   ✅ /api/config           → baca konfigurasi aktif (timeout, model, url)
#   ✅ /api/ping, /api/echo  → util debug
#
#  Peningkatan Teknis:
#   • Timeout Ollama 600s (10 menit) + retry otomatis (3x, backoff)
#   • Auto-detect port ollama 11435 → 11434 (fallback)
#   • Normalisasi respons (tak pernah "undefined")
#   • CT-aware: deteksi pertanyaan pemrograman untuk ubah prompt
#   • Template prompt gaya belajar (Visual/Auditori/Kinestetik)
#   • SSE-ready (bisa diubah ke "text/event-stream" jika dibutuhkan)
#   • Logging detail dan rapi untuk debugging
#   • Kolektor metrik sederhana (jumlah request, rata-rata durasi, error)
#   • Sanitizer & guard rails ringkas
#   • Kompatibel penuh dengan script.js panjang kamu
# =============================================================================

from fastapi import FastAPI, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    JSONResponse,
    StreamingResponse,
    PlainTextResponse,
    FileResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Generator, Any, Tuple

import os
import re
import io
import json
import time
import math
import uuid
import glob
import shutil
import random
import string
import base64
import hashlib
import logging
import datetime
import traceback
import requests

# =============================================================================
# Konfigurasi & Konstanta
# =============================================================================

APP_NAME = "CSIPBLLM API Ultra"
APP_VERSION = "5.2.0"  # bumped minor version for cognitive compare + comprehension loop

# Auto-detect port Ollama (11435 lalu 11434)
OLLAMA_PORTS = [
    int(os.environ.get("OLLAMA_PORT", "11435")),
    11434,
]

# URL dasar lain
def _build_ollama_urls(port: int) -> Dict[str, str]:
    base = f"http://localhost:{port}"
    return {
        "generate": f"{base}/api/generate",
        "tags": f"{base}/api/tags",
        "version": f"{base}/api/version",
        "embeddings": f"{base}/api/embeddings",  # jika suatu saat dipakai
    }

OLLAMA_URLS = None
for p in OLLAMA_PORTS:
    try:
        r = requests.get(f"http://localhost:{p}/api/version", timeout=1.8)
        if r.ok:
            OLLAMA_URLS = _build_ollama_urls(p)
            break
    except Exception:
        continue

if not OLLAMA_URLS:
    # fallback ke 11434
    OLLAMA_URLS = _build_ollama_urls(11434)

# Model default (bisa diganti runtime via /api/set_model)
MODEL_NAME = os.environ.get("CSIPBLLM_MODEL", "deepseek-r1:8b")

# Timeout & Retry
REQUEST_TIMEOUT = int(os.environ.get("CSIPBLLM_TIMEOUT", "600"))  # 10 menit
MAX_RETRIES = int(os.environ.get("CSIPBLLM_RETRIES", "3"))
RETRY_BACKOFF_BASE = 2.0  # 2s, 4s, 8s, ...

# File riwayat
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "data"))
os.makedirs(DATA_DIR, exist_ok=True)
HISTORY_FILE = os.path.join(DATA_DIR, "chat_history.json")
MAX_HISTORY_ITEMS = 500

# Static dir (opsional)
STATIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "static"))
if not os.path.isdir(STATIC_DIR):
    os.makedirs(STATIC_DIR, exist_ok=True)

# =============================================================================
# Logging
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="time=%(asctime)s level=%(levelname)s msg=%(message)s",
)
log = logging.getLogger(APP_NAME)

def L(msg: str):
    log.info(msg)

def LW(msg: str):
    log.warning(msg)

def LE(msg: str):
    log.error(msg)

# =============================================================================
# App & CORS & Static
# =============================================================================

app = FastAPI(title=APP_NAME, version=APP_VERSION)

# CORS longgar agar bisa diakses dari mana saja (dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static (opsional)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Serve index jika ada
@app.get("/")
def _root():
    idx = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(idx):
        return FileResponse(idx)
    return JSONResponse({"api": APP_NAME, "version": APP_VERSION})

# =============================================================================
# Utilitas Umum
# =============================================================================

def now_iso() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def short_id(n=8) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))

def clamp(v: float, a: float, b: float) -> float:
    return max(a, min(b, v))

def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()

def ensure_json(obj: Any) -> Dict[str, Any]:
    if isinstance(obj, dict):
        return obj
    try:
        return json.loads(obj)
    except Exception:
        return {"raw": str(obj)}

# =============================================================================
# Penyimpanan & Riwayat
# =============================================================================

# memori runtime singkat
conversation_buffer: List[Dict[str, Any]] = []

def read_history_file() -> List[Dict[str, Any]]:
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        LE(f"read_history_file error: {e}")
    return []

def write_history_file(items: List[Dict[str, Any]]):
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
    except Exception as e:
        LE(f"write_history_file error: {e}")

def append_history_item(item: Dict[str, Any]):
    items = read_history_file()
    items.append(item)
    if len(items) > MAX_HISTORY_ITEMS:
        items = items[-MAX_HISTORY_ITEMS:]
    write_history_file(items)

# Export / Import
def export_history_text(items: List[Dict[str, Any]]) -> str:
    lines = []
    for i, it in enumerate(items, 1):
        tt = it.get("timestamp", "")
        tp = it.get("type", "")
        lines.append(f"[{i}] {tt}  ({tp})")
        if tp in ("chat", "api_generate"):
            q = it.get("user_message") or it.get("prompt") or ""
            a = it.get("reply_main") or it.get("answer") or it.get("response") or ""
            lines.append(f"Q: {q}")
            lines.append(f"A: {a}")
        elif tp == "evaluate":
            lines.append("Eval: " + (it.get("feedback") or ""))
        lines.append("-" * 50)
    return "\n".join(lines)

# =============================================================================
# Pydantic Models (Requests)
# =============================================================================

class ChatRequest(BaseModel):
    message: str = Field(..., description="Pertanyaan / instruksi pengguna")
    style: str = Field("Visual", description="Visual | Auditori | Kinestetik")
    profession: Optional[str] = ""
    age: Optional[str] = ""
    profile: Optional[str] = ""
    ct_focus: Optional[str] = ""

class EvalRequest(BaseModel):
    answer: str
    correct_answer: str
    wrong_count: int = 0
    profile: Optional[str] = ""
    ct_focus: Optional[str] = ""

class RecommendRequest(BaseModel):
    style: str
    profession: Optional[str] = "Pelajar"
    age: Optional[str] = "0"

class SetModel(BaseModel):
    model: str

class ImportHistoryPayload(BaseModel):
    items: List[Dict[str, Any]]

class ComprehensionRequest(BaseModel):
    original_question: str
    user_reply: str
    user_style: str = "Visual"
    compare_style: str = "Auditori"  # style acak yang dipakai untuk perbandingan
    last_bot_explanations: Optional[str] = ""  # gabungan dua penjelasan sebelumnya (opsional)

# =============================================================================
# Heuristik & Guard Rails Ringan
# =============================================================================

CODE_REGEX = re.compile(
    r"```[\s\S]*?```|(\bfor\b|\bwhile\b|\bif\b|\bdef\b|\bclass\b|\breturn\b|;\s*$|=\s*)"
)

def is_code_like(text: str) -> bool:
    return bool(CODE_REGEX.search(text or ""))

DISALLOWED = [
    "bom", "bom rakitan", "cara bikin bom", "senjata api", "eksplosif, bahan peledak", "ransomware", "malware", "carding", "phishing"
]
def content_safety(text: str) -> bool:
    t = (text or "").lower()
    for bad in DISALLOWED:
        if bad in t:
            return False
    return True

# =============================================================================
# Prompt Templates
# =============================================================================

STYLE_MAP = {
    "visual": "Gunakan analogi visual, poin, dan struktur bertingkat. Sertakan diagram mental bila relevan.",
    "auditori": "Jelaskan seperti bercerita, gunakan ritme, intonasi, dan penguatan verbal.",
    "kinestetik": "Ajak pengguna 'melakukan', beri langkah praktik, simulasi, atau eksperimen kecil.",
}

def build_prompt_for_style(req: ChatRequest) -> str:
    style = (req.style or "Visual").strip().lower()
    style_hint = STYLE_MAP.get(style, STYLE_MAP["visual"])
    code_mode = is_code_like(req.message)

    header = (
        "Anda adalah tutor adaptif bernama CSIPBLLM. "
        f"Gaya belajar utama: {style.capitalize()}. {style_hint}\n"
        f"Profil pengguna: Profesi={req.profession or '-'}, Usia={req.age or '-'}.\n"
    )

    if code_mode:
        body = (
            "Pertanyaan/masalah tampaknya terkait kode atau algoritma. "
            "Jelaskan langkah berpikir komputasional (dekomposisi, pengenalan pola, abstraksi, algoritma), "
            "tidak perlu terikat bahasa pemrograman tertentu, tapi boleh beri pseudo-code.\n\n"
            f"Pertanyaan:\n{req.message}\n\n"
            "Jawaban yang diharapkan: Jelaskan konsep utama, alur solusi, dan contoh singkat."
        )
    else:
        body = (
            "Jelaskan dengan bahasa Indonesia yang jelas, ringkas, dan terstruktur. "
            "Jika relevan, sertakan contoh konkret atau analogi sehari-hari.\n\n"
            f"Pertanyaan:\n{req.message}\n\n"
            "Jawaban:"
        )
    return f"{header}\n{body}"

def build_compare_prompt(message: str, style: str) -> str:
    style = (style or "visual").lower()
    hint = STYLE_MAP.get(style, STYLE_MAP["visual"])
    return (
        f"Buat ulang penjelasan yang lebih sesuai gaya '{style}', {hint}.\n"
        f"Pertanyaan:\n{message}\n\n"
        "Jawaban perbandingan singkat:"
    )

def build_followup_prompt(answer: str) -> str:
    return (
        "Kamu tutor interaktif. Berdasarkan jawaban berikut, buat SATU pertanyaan lanjutan "
        "yang merangsang berpikir kritis (tanpa membocorkan jawaban) dan 1 kalimat saja.\n\n"
        f"Jawaban:\n{answer}\n\n"
        "Pertanyaan lanjutan:"
    )

def build_eval_prompt(ans: str, key: str, hint_label: str, code: bool) -> str:
    base = (
        f"Kamu tutor adaptif. Tahap: {hint_label}. Evaluasi jawaban siswa vs kunci berikut. "
        "Tuliskan umpan balik edukatif dan petunjuk bertahap, tanpa langsung membocorkan jawaban final.\n\n"
        f"Jawaban siswa:\n{ans}\n\nKunci:\n{key}\n\nUmpan balik:"
    )
    if code:
        base = (
            f"Kamu tutor algoritma. Tahap: {hint_label}. Evaluasi berbasis konsep (abaikan detail sintaks). "
            "Berikan umpan balik edukatif dan petunjuk bertahap.\n\n"
            f"Jawaban siswa:\n{ans}\n\nKunci konsep:\n{key}\n\nUmpan balik:"
        )
    return base

# ====== Tambahan untuk Dual Cognitive & Comprehension Loop ======

def pick_other_style(user_style: str) -> str:
    user_style = (user_style or "Visual").strip().lower()
    options = ["visual", "auditori", "kinestetik"]
    candidates = [s for s in options if s != user_style]
    return random.choice(candidates).capitalize()

def build_dual_explanations_prompt(user_style: str, other_style: str, message: str) -> str:
    """
    Minta model menghasilkan DUA penjelasan terpisah, berlabel jelas:
    - Kognitif Pengguna (user_style)
    - Kognitif Perbandingan (other_style)
    Serta ringkas perbedaan pendekatannya. Jangan memberi jawaban final dalam bentuk solusi numerik
    jika pertanyaannya problem solving; tekankan pemahaman.
    """
    uhint = STYLE_MAP.get((user_style or "Visual").lower(), STYLE_MAP["visual"])
    ohint = STYLE_MAP.get((other_style or "Visual").lower(), STYLE_MAP["visual"])

    return (
        "Anda adalah tutor adaptif yang menyajikan dua gaya pemahaman.\n"
        f"Gaya 1 (pengguna): {user_style}. {uhint}\n"
        f"Gaya 2 (perbandingan): {other_style}. {ohint}\n\n"
        "Format output HARUS seperti ini (wajib judul yang sama persis):\n"
        "## Kognitif Pengguna\n"
        "<isi penjelasan gaya pengguna>\n\n"
        "## Kognitif Perbandingan\n"
        "<isi penjelasan gaya lain>\n\n"
        "## Perbedaan Pendekatan (Singkat)\n"
        "<maksimal 3 poin yang membandingkan>\n\n"
        f"Topik/pertanyaan pengguna:\n{message}\n\n"
        "Catatan: tetap jelaskan untuk pemahaman; jangan langsung memberi jawaban akhir jika berupa soal."
    )

def build_followup_check_question(message: str, user_style: str, other_style: str, twin_explanations: str) -> str:
    """
    Buat satu pertanyaan verifikasi pemahaman (tanpa bocor jawaban).
    """
    return (
        "Kamu tutor adaptif. Berdasarkan dua penjelasan berikut (gaya pengguna dan gaya perbandingan), "
        "buat SATU pertanyaan pendek untuk memeriksa pemahaman pengguna. Jangan memberi jawaban.\n\n"
        f"Ringkasan dua penjelasan:\n{twin_explanations}\n\n"
        f"Konteks: pertanyaan awal = {message}\n"
        f"Gaya pengguna: {user_style}; Gaya pembanding: {other_style}\n\n"
        "Tulis hanya satu kalimat tanya:"
    )

def build_comprehension_judge_prompt(original_question: str, user_reply: str, user_style: str, compare_style: str, last_bot_explanations: str) -> str:
    """
    Nilai apakah pengguna sudah mengerti atau belum, berdasar jawaban pengguna terhadap follow-up.
    Output HARUS JSON dengan keys:
      understood: true/false
      feedback: string (jelaskan ringkas, tanpa memberi jawaban final)
      next_question: string | null (Jika belum mengerti, berikan SATU pertanyaan lanjutan)
    """
    return (
        "Kamu adalah tutor adaptif yang menilai pemahaman.\n"
        "Format output HARUS JSON valid dengan properti persis: understood (boolean), feedback (string), next_question (string atau null).\n\n"
        f"Pertanyaan awal:\n{original_question}\n\n"
        f"Ringkasan penjelasan bot (dua gaya):\n{last_bot_explanations}\n\n"
        f"Jawaban pengguna terhadap pertanyaan cek pemahaman:\n{user_reply}\n\n"
        "Kriteria: Jika jawaban menunjukkan pemahaman konsep kunci (meski belum sempurna), set understood=true. "
        "Jika belum, berikan umpan balik edukatif singkat tanpa membocorkan jawaban final, dan berikan next_question yang memandu.\n"
        "Output JSON saja, tanpa teks tambahan:"
    )

# =============================================================================
# === PATCH: Tambahan helper untuk skenario baru (TIDAK mengganti yang lama) ==
# =============================================================================

def build_prompt_user(req: ChatRequest) -> str:
    st = (req.style or "Visual").lower()
    hint = STYLE_MAP.get(st, STYLE_MAP["visual"])
    return (
        f"Kamu tutor adaptif. Gaya belajar pengguna: {req.style}. {hint}\n"
        f"Pertanyaan pengguna:\n{req.message}\n\n"
        "Jelaskan sesuai gaya tersebut agar mudah dipahami. "
        "⚠️ Jangan berikan jawaban final; bantu pengguna memahami konsepnya lebih dulu."
    )

def build_prompt_other(message: str, style: str) -> str:
    st = (style or "Visual").lower()
    hint = STYLE_MAP.get(st, STYLE_MAP["visual"])
    return (
        f"Jelaskan ulang topik berikut dengan gaya belajar {style}. {hint}\n\n"
        f"Topik:\n{message}\n\n"
        "Fokus pada cara berbeda menjelaskan konsep. ⚠️ Jangan memberi jawaban final."
    )

def build_reflective_question_prompt(message: str, user_answer: str, other_answer: str) -> str:
    return (
        "Kamu tutor reflektif. Berdasarkan dua penjelasan di bawah ini, "
        "buat SATU pertanyaan reflektif singkat (1 kalimat) untuk mengecek pemahaman pengguna. "
        "⚠️ Jangan menjelaskan ulang dan jangan memberi jawaban.\n\n"
        f"Pertanyaan pengguna: {message}\n\n"
        f"[Gaya pengguna]\n{user_answer}\n\n"
        f"[Gaya perbandingan]\n{other_answer}\n\n"
        "Pertanyaan reflektif:"
    )

# =============================================================================
# Inti: Query ke Ollama (single-shot & streaming)
# =============================================================================

def normalize_ollama_json(payload: Any) -> str:
    if isinstance(payload, dict):
        return payload.get("response") or payload.get("output") or payload.get("message") or payload.get("data") or ""
    if isinstance(payload, list):
        return "".join(x.get("response", "") or x.get("output", "") for x in payload)
    return str(payload or "")

def post_ollama_generate(prompt: str, model: Optional[str] = None, stream: bool = False):
    url = OLLAMA_URLS["generate"]
    data = {"model": model or MODEL_NAME, "prompt": prompt}
    if stream:
        data["stream"] = True
    return requests.post(url, json=data, stream=stream, timeout=REQUEST_TIMEOUT)

def query_ollama(prompt: str, model: Optional[str] = None, retries: int = MAX_RETRIES) -> str:
    """
    Single-shot query ke Ollama dengan retry & backoff.
    """
    for attempt in range(retries):
        try:
            t0 = time.time()
            resp = post_ollama_generate(prompt, model=model, stream=False)
            if resp.status_code == 200:
                text = normalize_ollama_json(resp.json()).strip()
                t1 = time.time()
                L(f"[Ollama] ok {round(t1 - t0, 2)}s, {len(text)} chars")
                return text or "[⚠️ Model tidak mengembalikan teks.]"
            else:
                LW(f"[Ollama] HTTP {resp.status_code}: {resp.text[:200]}")
        except requests.exceptions.RequestException as e:
            LE(f"[Ollama] req error: {e}")
        # backoff
        sleep_s = (RETRY_BACKOFF_BASE ** attempt)
        time.sleep(sleep_s)
    return "[⚠️ Tidak ada respon dari Ollama setelah beberapa percobaan.]"

def stream_ollama(prompt: str, model: Optional[str] = None) -> Generator[bytes, None, None]:
    """
    Proxy NDJSON stream → text/plain.
    """
    try:
        with post_ollama_generate(prompt, model=model, stream=True) as r:
            if not r.ok:
                yield f"[stream error http {r.status_code}]".encode()
                return
            for raw in r.iter_lines(decode_unicode=True):
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                    chunk = obj.get("response", "")
                except Exception:
                    chunk = raw
                yield chunk.encode("utf-8")
    except Exception as e:
        yield f"[stream exception: {e}]".encode("utf-8")

# =============================================================================
# Mini Evaluator & Hint Stage
# =============================================================================

def hint_stage(wrong: int) -> Tuple[str, str]:
    if wrong <= 0:
        return "Baseline", "Ajukan satu pertanyaan reflektif."
    if wrong == 1:
        return "Directive Hint", "Berikan petunjuk singkat yang spesifik."
    if wrong == 2:
        return "Remedial Scaffold", "Bimbing langkah demi langkah."
    return "Facilitative Guide", "Arahkan untuk menemukan pola inti."

def crude_correctness(feedback: str) -> bool:
    s = (feedback or "").lower()
    return ("benar" in s and "tidak" not in s) or ("tepat" in s and "kurang" not in s)

# =============================================================================
# Health / Metrics
# =============================================================================

metrics = {
    "requests_total": 0,
    "requests_error": 0,
    "avg_latency_ms": 0.0,
}

def record_metric(latency_ms: float, ok=True):
    metrics["requests_total"] += 1
    if not ok:
        metrics["requests_error"] += 1
    # EMA sederhana
    alpha = 0.2
    metrics["avg_latency_ms"] = (1 - alpha) * metrics["avg_latency_ms"] + alpha * latency_ms

# =============================================================================
# Endpoints
# =============================================================================

@app.get("/api/status")
def api_status():
    """
    Health check backend & versi Ollama.
    """
    info = {
        "backend": "online",
        "version": APP_VERSION,
        "ollama_url": OLLAMA_URLS["generate"],
        "model": MODEL_NAME,
        "timeout": REQUEST_TIMEOUT,
        "retries": MAX_RETRIES,
        "metrics": metrics,
    }
    try:
        rv = requests.get(OLLAMA_URLS["version"], timeout=2)
        if rv.ok:
            info["ollama_status"] = "online"
            info["ollama_version"] = rv.json().get("version")
        else:
            info["ollama_status"] = "offline"
    except Exception:
        info["ollama_status"] = "offline"
    return info

@app.get("/api/config")
def api_config():
    return {
        "model": MODEL_NAME,
        "timeout": REQUEST_TIMEOUT,
        "retries": MAX_RETRIES,
        "ollama": OLLAMA_URLS,
        "history_file": HISTORY_FILE,
        "max_history_items": MAX_HISTORY_ITEMS,
    }

@app.get("/api/models")
def api_models():
    try:
        r = requests.get(OLLAMA_URLS["tags"], timeout=4)
        data = r.json()
        models = [x.get("name") for x in data.get("models", [])]
        return {"models": models}
    except Exception as e:
        return {"models": [], "error": str(e)}

@app.post("/api/set_model")
def api_set_model(req: SetModel):
    global MODEL_NAME
    MODEL_NAME = (req.model or MODEL_NAME).strip()
    return {"message": f"✅ Model aktif diganti ke {MODEL_NAME}"}

# ---------- Single-shot untuk script.js (LAMA → DIPERTAHANKAN) ----------
# >>>> TIDAK DIHAPUS, hanya dipindahkan endpointnya agar tidak konflik
@app.post("/api/generate_legacy")
def api_generate_legacy(req: ChatRequest):
    """
    [LEGACY] Versi lama /api/generate — dipertahankan utuh agar tidak ada baris hilang.
    """
    t0 = time.time()
    try:
        if not content_safety(req.message):
            return {"response": "❌ Maaf, permintaan tersebut tidak dapat diproses."}

        # ---- dual explanations (pengguna + random style) ----
        user_style = (req.style or "Visual").capitalize()
        other_style = pick_other_style(user_style)
        prompt_dual = build_dual_explanations_prompt(user_style, other_style, req.message)
        twin = query_ollama(prompt_dual, model=MODEL_NAME)

        # Extract sections from twin (best-effort). We keep full text regardless.
        def _extract(section_title: str, text: str) -> str:
            # naive splitter by heading
            pattern = rf"## {re.escape(section_title)}\s*(.+?)(?=\n## |\Z)"
            m = re.search(pattern, text, flags=re.S|re.M)
            return (m.group(1).strip() if m else "").strip()

        kognitif_user = _extract("Kognitif Pengguna", twin)
        kognitif_other = _extract("Kognitif Perbandingan", twin)
        diff_short = _extract("Perbedaan Pendekatan (Singkat)", twin)

        # fallback jika extractor gagal
        if not kognitif_user or not kognitif_other:
            # gunakan builder lama sebagai jaga-jaga
            base_prompt = build_prompt_for_style(req)
            base_answer = query_ollama(base_prompt, model=MODEL_NAME)
            kognitif_user = kognitif_user or base_answer
            alt_prompt = build_compare_prompt(req.message, other_style)
            alt_answer = query_ollama(alt_prompt, model=MODEL_NAME)
            kognitif_other = kognitif_other or alt_answer
            twin = f"## Kognitif Pengguna\n{kognitif_user}\n\n## Kognitif Perbandingan\n{kognitif_other}"

        # ---- evaluasi ringan, tetap ada
        evaluation = (
            "✅ Penjelasan sudah cukup kuat." if len(twin) > 200
            else "💡 Jawaban masih pendek, tambahkan contoh konkret."
        )

        # ---- follow-up question untuk cek pemahaman
        fup_prompt = build_followup_check_question(req.message, user_style, other_style, twin)
        followup = query_ollama(fup_prompt, model=MODEL_NAME).strip()

        # ---- field kompatibilitas lama
        comparison_legacy = f"Gaya {user_style} vs {other_style}: pendekatan penyampaian berbeda, sesuaikan strategi belajarmu."

        # ---- simpan riwayat lengkap
        rec = {
            "timestamp": now_iso(),
            "type": "api_generate_legacy",
            "prompt": req.message,
            "style": user_style,
            "answer": twin,                     # full twin explanations
            "evaluation": evaluation,
            "comparison": comparison_legacy,
            "followup": followup,
            "kognitif_pengguna": kognitif_user,
            "kognitif_perbandingan": kognitif_other,
            "compare_style": other_style,
            "diff_short": diff_short,
        }
        conversation_buffer.append(rec)
        append_history_item(rec)

        latency = (time.time() - t0) * 1000
        record_metric(latency, ok=True)
        return {
            # baru
            "kognitif_pengguna": kognitif_user,
            "kognitif_perbandingan": kognitif_other,
            "perbedaan_pendekatan": diff_short,
            "compare_style": other_style,
            "twin_explanations": twin,
            "followup": followup,
            # lama (kompat)
            "response": twin,                  # agar UI lama tetap menampilkan sesuatu
            "evaluation": evaluation,
            "comparison": comparison_legacy,
            "latency_ms": round(latency, 1),
        }
    except Exception as e:
        latency = (time.time() - t0) * 1000
        record_metric(latency, ok=False)
        LE(f"/api/generate_legacy error: {e}")
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)

# ---------- Single-shot untuk script.js (BARU: sesuai alur kamu) ----------
@app.post("/api/generate")
def api_generate(req: ChatRequest):
    """
    BARU (sesuai instruksi): urutan bertahap
      1) Jawaban gaya pengguna
      2) Jawaban perbandingan (gaya acak)
      3) Pertanyaan reflektif (tanpa memberi jawaban final)
    """
    t0 = time.time()
    try:
        if not content_safety(req.message):
            return {"response": "❌ Maaf, permintaan tersebut tidak dapat diproses."}

        user_style = (req.style or "Visual").capitalize()
        other_style = pick_other_style(user_style)

        # 1) Kognitif Pengguna
        p_user = build_prompt_user(req)
        ans_user = query_ollama(p_user, model=MODEL_NAME)

        # 2) Kognitif Perbandingan (random)
        p_other = build_prompt_other(req.message, other_style)
        ans_other = query_ollama(p_other, model=MODEL_NAME)

        # 3) Pertanyaan reflektif — satu kalimat, tanpa jawaban
        p_ref = build_reflective_question_prompt(req.message, ans_user, ans_other)
        followup = query_ollama(p_ref, model=MODEL_NAME).strip()
        followup = re.split(r"[.!?]\s+", followup.strip())[0] + "?"

        # Gabungan untuk tampilan/riwayat
        twin = (
            f"## Kognitif Pengguna ({user_style})\n{ans_user}\n\n"
            f"## Kognitif Perbandingan ({other_style})\n{ans_other}"
        )

        # Simpan riwayat (tanpa menghapus mekanisme lama)
        rec = {
            "timestamp": now_iso(),
            "type": "api_generate",
            "prompt": req.message,
            "style": user_style,
            "answer_user": ans_user,
            "answer_other": ans_other,
            "compare_style": other_style,
            "followup": followup,
        }
        conversation_buffer.append(rec)
        append_history_item(rec)

        latency = (time.time() - t0) * 1000
        record_metric(latency, ok=True)
        return {
            "response": twin,
            "kognitif_pengguna": ans_user,
            "kognitif_perbandingan": ans_other,
            "compare_style": other_style,
            "followup": followup,
            "latency_ms": round(latency, 1),
        }
    except Exception as e:
        latency = (time.time() - t0) * 1000
        record_metric(latency, ok=False)
        LE(f"/api/generate error: {e}")
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)

# ---------- Chat lengkap (main + compare + follow-up) ----------
# FIXED: FastAPI-native (mengganti versi Flask-style yang menyebabkan 422)
@app.post("/chat")
async def chat(req: Request):
    try:
        data = await req.json()
        question = (data.get("question") or "").strip()
        model = data.get("model", MODEL_NAME)

        if not question:
            return JSONResponse({"error": "Pertanyaan tidak boleh kosong"}, status_code=400)

        # Gunakan generator standar (bukan ollama.chat langsung) agar konsisten
        prompt = f"Kamu adalah asisten pembelajaran adaptif.\n\nPertanyaan:\n{question}"
        answer = query_ollama(prompt, model=model)

        return JSONResponse({"answer": answer})
    except Exception as e:
        LE(f"/chat error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

# ---------- Streaming ----------
@app.post("/chat_stream")
def chat_stream(req: ChatRequest):
    try:
        p = build_prompt_for_style(req)
        gen = stream_ollama(p, model=MODEL_NAME)
        return StreamingResponse(gen, media_type="text/plain; charset=utf-8")
    except Exception as e:
        return StreamingResponse(iter([f"[stream error: {e}]".encode()]), media_type="text/plain")

# ---------- Rekomendasi ----------
@app.post("/recommend")
def recommend(req: RecommendRequest):
    style = (req.style or "Visual").capitalize()
    recs = {
        "Visual": [
            "Gunakan diagram, mindmap, dan warna untuk memperjelas konsep.",
            "Tonton video pembelajaran yang relevan.",
            "Buat ringkasan visual (sketsa cepat) setelah belajar."
        ],
        "Auditori": [
            "Dengarkan podcast/rekaman penjelasan.",
            "Diskusikan materi dengan teman.",
            "Gunakan text-to-speech untuk membaca catatan."
        ],
        "Kinestetik": [
            "Lakukan praktik langsung/proyek kecil.",
            "Gunakan simulasi interaktif atau eksperimen sederhana.",
            "Belajar sambil menulis tangan atau membuat model fisik."
        ],
    }
    return {"style": style, "recommendations": recs.get(style, ["Coba gaya belajar campuran untuk fleksibilitas."])}

# ---------- Evaluasi adaptif ----------
@app.post("/evaluate")
def evaluate(req: EvalRequest):
    try:
        wrong = int(req.wrong_count or 0)
        hint_lbl, tutor_role = hint_stage(wrong)
        code = is_code_like(req.answer)

        p = build_eval_prompt(req.answer, req.correct_answer, hint_lbl, code)
        feedback = query_ollama(p)
        correct_flag = crude_correctness(feedback)

        f_prompt = (
            "Kamu tutor interaktif. Berdasarkan evaluasi & kunci konsep ini, "
            f"{tutor_role} Satu kalimat, tanpa membocorkan jawaban.\n\n"
            f"Jawaban siswa:\n{req.answer}\n\nKunci:\n{req.correct_answer}\n\nPertanyaan:"
        )
        followup = query_ollama(f_prompt)

        rec = {
            "timestamp": now_iso(),
            "type": "evaluate",
            "student_answer": req.answer,
            "correct_answer": req.correct_answer,
            "hint_level": hint_lbl,
            "feedback": feedback,
            "is_correct": correct_flag,
            "followup_question": followup,
            "is_code": code,
        }
        conversation_buffer.append(rec)
        append_history_item(rec)

        return {
            "is_correct": correct_flag,
            "feedback": feedback,
            "hint_level": hint_lbl,
            "followup_question": followup,
            "is_code": code,
        }
    except Exception as e:
        return {"error": str(e)}
    
# ================================================================
# Prompt Engineering Experiment Endpoint
# ================================================================
@app.post("/api/prompt_experiments")
def api_prompt_experiments(payload: Dict[str, Any]):
    """
    Jalankan eksperimen prompt engineering:
      • zero-shot
      • few-shot
      • chain-of-thought (CoT)
      • structured step-by-step
    """
    try:
        user_query = (payload.get("query") or "").strip()
        model = payload.get("model", MODEL_NAME)

        if not user_query:
            return {"error": "Query tidak boleh kosong"}

        # --------------------------------
        # Zero-Shot
        # --------------------------------
        p_zero = (
            "Jawab pertanyaan berikut secara langsung.\n\n"
            f"Pertanyaan:\n{user_query}\n"
        )
        out_zero = query_ollama(p_zero, model=model)

        # --------------------------------
        # Few-Shot Example (2 contoh)
        # --------------------------------
        p_few = (
            "Berikut contoh pola tanya-jawab:\n\n"
            "Q: Apa itu variabel?\n"
            "A: Variabel adalah wadah untuk menyimpan nilai.\n\n"
            "Q: Apa itu loop?\n"
            "A: Loop adalah instruksi yang berulang.\n\n"
            "Sekarang jawab pertanyaan pengguna dengan pola serupa.\n\n"
            f"Q: {user_query}\nA:"
        )
        out_few = query_ollama(p_few, model=model)

        # --------------------------------
        # Chain-of-Thought Reasoning
        # --------------------------------
        p_cot = (
            "Jelaskan langkah berpikir secara eksplisit (Chain-of-Thought), "
            "lalu berikan jawaban akhir.\n\n"
            f"Pertanyaan:\n{user_query}\n\n"
            "Format:\n"
            "Langkah berpikir:\n1) ...\n2) ...\n3) ...\n\n"
            "Jawaban akhir:"
        )
        out_cot = query_ollama(p_cot, model=model)

        # --------------------------------
        # Structured Prompting
        # --------------------------------
        p_struct = (
            "Jawab pertanyaan dengan struktur berikut:\n"
            "- Definisi / Konsep Inti\n"
            "- Analisis Masalah\n"
            "- Solusi Langkah Demi Langkah\n"
            "- Penutup Ringkas\n\n"
            f"Pertanyaan:\n{user_query}\n"
        )
        out_struct = query_ollama(p_struct, model=model)

        # --------------------------------
        # Hasil Akhir
        # --------------------------------
        result = {
            "query": user_query,
            "model": model,
            "zero_shot": out_zero,
            "few_shot": out_few,
            "chain_of_thought": out_cot,
            "structured": out_struct
        }

        # Simpan ringkasan ke history
        append_history_item({
            "timestamp": now_iso(),
            "type": "prompt_experiment",
            "query": user_query,
            "results": result
        })

        return result

    except Exception as e:
        return {"error": str(e)}

# ---------- Comprehension Loop ----------
@app.post("/comprehension_check")
def comprehension_check(req: ComprehensionRequest):
    """
    Menilai apakah pengguna sudah mengerti berdasarkan jawaban user terhadap follow-up.
    Jika belum, kembalikan feedback singkat + next_question (pertanyaan lanjutan).
    """
    try:
        prompt = build_comprehension_judge_prompt(
            original_question=req.original_question,
            user_reply=req.user_reply,
            user_style=req.user_style,
            compare_style=req.compare_style,
            last_bot_explanations=req.last_bot_explanations or ""
        )
        raw = query_ollama(prompt, model=MODEL_NAME)
        # best-effort: parse JSON
        data = {}
        try:
            # Model terkadang mengirim code block. Bersihkan fence jika ada.
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.S)
            data = json.loads(cleaned)
        except Exception:
            # fallback aman
            data = {"understood": False, "feedback": raw[:400], "next_question": None}

        understood = bool(data.get("understood", False))
        feedback = str(data.get("feedback", "")).strip() or "(tidak ada feedback)"
        next_q = (data.get("next_question") or None)
        rec = {
            "timestamp": now_iso(),
            "type": "comprehension",
            "understood": understood,
            "feedback": feedback,
            "next_question": next_q,
            "ctx": {
                "original_question": req.original_question,
                "user_style": req.user_style,
                "compare_style": req.compare_style
            }
        }
        conversation_buffer.append(rec)
        append_history_item(rec)
        return {
            "understood": understood,
            "feedback": feedback,
            "next_question": next_q
        }
    except Exception as e:
        LE(f"/comprehension_check error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

# ---------- History ----------
@app.get("/api/history")
def api_history(format: str = "json"):
    mem = conversation_buffer[:]
    file_hist = read_history_file()
    merged = file_hist + mem
    if format == "text":
        return PlainTextResponse(export_history_text(merged) or "Belum ada percakapan.")
    return {"history": merged, "total": len(merged)}

@app.post("/api/history/clear")
def api_history_clear():
    conversation_buffer.clear()
    try:
        if os.path.exists(HISTORY_FILE):
            os.remove(HISTORY_FILE)
    except Exception:
        pass
    return {"message": "✅ Riwayat dibersihkan."}

@app.get("/api/history/export")
def api_history_export(fmt: str = "json"):
    items = read_history_file() + conversation_buffer
    if fmt == "text":
        text = export_history_text(items)
        return PlainTextResponse(text or "Belum ada percakapan.")
    return JSONResponse(content=items)

@app.post("/api/history/import")
def api_history_import(payload: ImportHistoryPayload):
    items = payload.items or []
    if not isinstance(items, list):
        return JSONResponse({"error": "Format tidak valid"}, status_code=400)
    # batasi jumlah, validasi ringan
    clean = []
    for x in items[:MAX_HISTORY_ITEMS]:
        if isinstance(x, dict):
            clean.append(x)
    write_history_file(clean)
    return {"message": f"✅ Import {len(clean)} item riwayat berhasil."}

# ---------- Util Debug ----------
@app.get("/api/ping")
def api_ping():
    return {"pong": True, "ts": now_iso()}

@app.post("/api/echo")
async def api_echo(req: Request):
    try:
        raw = await req.body()
        try:
            data = json.loads(raw.decode() if isinstance(raw, (bytes, bytearray)) else str(raw))
        except Exception:
            data = {"raw": (raw.decode() if isinstance(raw, (bytes, bytearray)) else str(raw))}
    except Exception:
        data = {"raw": "<parse_error>"}
    return {"you_sent": data, "ts": now_iso()}

# =============================================================================
# Main
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    L("Menjalankan server FastAPI (Ultra) di http://127.0.0.1:8000 🚀")
    L(f"Model default        : {MODEL_NAME}")
    L(f"Ollama generate URL  : {OLLAMA_URLS['generate']}")
    L(f"Timeout (detik)      : {REQUEST_TIMEOUT}")
    L(f"Retries              : {MAX_RETRIES}")
    uvicorn.run("ollamaapi:app", host="0.0.0.0", port=8000, reload=True)
