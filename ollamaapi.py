#  CSIPBLLM PERSONALIZED LEARNING SYSTEM — BACKEND (OLLAMA GPT-OSS)

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import requests
import json
import os
import time
import re
import random
import numpy as np

# import langchain_ollama jika tersedia
try:
    from langchain_ollama import ChatOllama, OllamaEmbeddings
    from langchain_community.chat_message_histories import ChatMessageHistory
except ImportError:
    ChatOllama = None          # type: ignore
    OllamaEmbeddings = None    # type: ignore
    ChatMessageHistory = None  # type: ignore

# faiss
try:
    import faiss  # type: ignore
except ImportError:
    faiss = None  # type: ignore

# config fastapi dan file static
app = FastAPI(title="CSIPBLLM - Kognitif + RAG (FastAPI)")

BASE_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(BASE_DIR, "static")

if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse({"error": "index.html tidak ditemukan"}, status_code=404)

# config ollama
OLLAMA_PORTS = [11435, 11434]
MODEL_NAME = "deepseek-r1:8b"  # model utama untuk chat & evaluasi
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "mxbai-embed-large")

OLLAMA_API_URL = None

for port in OLLAMA_PORTS:
    try:
        r = requests.get(f"http://localhost:{port}", timeout=2)
        if r.status_code in (200, 404):
            OLLAMA_API_URL = f"http://localhost:{port}/api/generate"
            print(f"[SYSTEM] ✅ Ollama terdeteksi di port {port}")
            break
    except Exception:
        continue

if not OLLAMA_API_URL:
    print("[SYSTEM] ⚠️ Tidak menemukan Ollama di port 11435/11434, asumsi 11434.")
    OLLAMA_API_URL = "http://localhost:11434/api/generate"

# config langchain
llm = None
base_ollama_url = OLLAMA_API_URL.rsplit("/api/generate", 1)[0] if OLLAMA_API_URL else None

if ChatOllama is not None and base_ollama_url:
    try:
        llm = ChatOllama(
            model=MODEL_NAME,
            temperature=0.7,
            base_url=base_ollama_url,
        )
        print("[SYSTEM] ✅ ChatOllama (LangChain) siap.")
    except Exception as e:
        llm = None
        print(f"[SYSTEM] ⚠️ Gagal inisialisasi ChatOllama: {e}")
else:
    print("[SYSTEM] ℹ️ LangChain ChatOllama tidak aktif, akan pakai HTTP langsung.")

# rag globals
MATERIALS_DIR = os.path.join(BASE_DIR, "materials")
EMBED_CACHE_PATH = os.path.join(BASE_DIR, "materials_index_cache.npy")
RAG_CHUNK_MAX_CHARS = 400
MAX_HISTORY_CHARS = 1200

materials_index: List[Dict] = []
materials_loaded = False
embeddings_model = None
faiss_index: Any = None

if OllamaEmbeddings is not None and base_ollama_url:
    try:
        embeddings_model = OllamaEmbeddings(
            model=EMBEDDING_MODEL_NAME,
            base_url=base_ollama_url,
        )
        print(f"[RAG] ✅ Embedding model: {EMBEDDING_MODEL_NAME}")
    except Exception as e:
        embeddings_model = None
        print(f"[RAG] ⚠️ Gagal inisialisasi embeddings: {e}")
else:
    print("[RAG] ℹ️ Embeddings Ollama tidak tersedia; RAG terbatas atau nonaktif.")


def build_faiss_index():
    """Bangun FAISS index dari materials_index (jika faiss tersedia)."""
    global faiss_index
    if faiss is None or not materials_index:
        return
    try:
        vecs = [item["embedding"] for item in materials_index]
        mat = np.stack(vecs).astype("float32")
        dim = mat.shape[1]
        index = faiss.IndexFlatIP(dim)
        index.add(mat)
        faiss_index = index
        print(f"[RAG] ✅ FAISS index dibangun (dim={dim}, n={mat.shape[0]}).")
    except Exception as e:
        faiss_index = None
        print(f"[RAG] ⚠️ Gagal membangun FAISS index: {e}")


def load_materials_and_build_index():
    """
    Memuat materi dari ./materials (txt/md) dan membangun index embedding.
    Menggunakan cache .npy jika tersedia.
    """
    global materials_loaded, materials_index

    if materials_loaded:
        return

    if embeddings_model is None:
        print("[RAG] ❌ Embeddings tidak tersedia; RAG dimatikan.")
        materials_loaded = True
        return

    if not os.path.isdir(MATERIALS_DIR):
        print("[RAG] ℹ️ Folder materials tidak ditemukan.")
        materials_loaded = True
        return

    # coba load cache
    if os.path.exists(EMBED_CACHE_PATH):
        try:
            print(f"[RAG] 🔄 Memuat index dari cache: {EMBED_CACHE_PATH}")
            loaded = np.load(EMBED_CACHE_PATH, allow_pickle=True)
            materials_index = loaded.tolist()
            for item in materials_index:
                v = np.array(item["embedding"], dtype="float32")
                norm = np.linalg.norm(v)
                if norm != 0:
                    item["embedding"] = v / norm
            build_faiss_index()
            materials_loaded = True
            print(f"[RAG] ✅ Index dimuat dari cache ({len(materials_index)} chunk).")
            return
        except Exception as e:
            print(f"[RAG] ⚠️ Gagal load cache, rebuild index: {e}")

    print(f"[RAG] 🔍 Membangun index RAG dari folder: {MATERIALS_DIR}")
    for root, _, files in os.walk(MATERIALS_DIR):
        for fname in files:
            if not fname.lower().endswith((".txt", ".md")):
                continue
            path = os.path.join(root, fname)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    text = f.read().strip()
            except Exception as e:
                print(f"[RAG] ⚠️ Gagal baca {path}: {e}")
                continue

            if not text:
                continue

            chunks = [text[i:i + 800] for i in range(0, len(text), 800)]
            for idx, chunk in enumerate(chunks):
                try:
                    emb = np.array(embeddings_model.embed_query(chunk), dtype="float32")
                except Exception as e:
                    print(f"[RAG] ⚠️ Gagal embed chunk {fname}#{idx}: {e}")
                    continue

                norm = np.linalg.norm(emb)
                if norm != 0:
                    emb = emb / norm

                materials_index.append(
                    {
                        "embedding": emb,
                        "text": chunk,
                        "source": fname,
                        "chunk_id": idx,
                    }
                )

    # save cache
    try:
        np.save(EMBED_CACHE_PATH, np.array(materials_index, dtype=object))
        print(f"[RAG] 💾 Cache index disimpan: {EMBED_CACHE_PATH}")
    except Exception as e:
        print(f"[RAG] ⚠️ Gagal simpan cache index: {e}")

    build_faiss_index()
    materials_loaded = True
    print(f"[RAG] ✅ Index RAG selesai ({len(materials_index)} chunk).")


def retrieve_relevant_chunks(query: str, k: int = 4) -> List[Dict]:
    """Ambil k chunk paling relevan via cosine similarity (FAISS jika ada)."""
    if embeddings_model is None or not materials_loaded or not materials_index:
        return []

    try:
        q_emb = np.array(embeddings_model.embed_query(query), dtype="float32")
    except Exception as e:
        print(f"[RAG] ⚠️ Gagal embed query RAG: {e}")
        return []

    norm = np.linalg.norm(q_emb)
    if norm != 0:
        q_emb = q_emb / norm

    results: List[Dict] = []

    # faiss
    if faiss_index is not None:
        try:
            D, I = faiss_index.search(q_emb.reshape(1, -1).astype("float32"), k)
            idxs = I[0]
            scores = D[0]
            for idx, score in zip(idxs, scores):
                if idx < 0 or score <= 0:
                    continue
                item = materials_index[int(idx)]
                results.append(
                    {
                        "text": item["text"],
                        "source": item["source"],
                        "score": float(score),
                    }
                )
            return results
        except Exception as e:
            print(f"[RAG] ⚠️ FAISS error, fallback NumPy: {e}")

    # numpy fallback
    scores = []
    for item in materials_index:
        score = float(np.dot(q_emb, item["embedding"]))
        scores.append(score)

    if not scores:
        return []

    idxs = np.argsort(scores)[::-1][:k]
    for i in idxs:
        score = scores[i]
        if score <= 0:
            continue
        item = materials_index[i]
        results.append(
            {
                "text": item["text"],
                "source": item["source"],
                "score": float(score),
            }
        )
    return results

# memory per session
session_histories: Dict[str, Any] = {}
conversation_history: List[Dict] = []


def get_session_history(session_id: str):
    if ChatMessageHistory is None:
        return None
    if session_id not in session_histories:
        session_histories[session_id] = ChatMessageHistory()
    return session_histories[session_id]


def format_history_as_text(history, max_chars: int = MAX_HISTORY_CHARS) -> str:
    if history is None or not getattr(history, "messages", None):
        return "Tidak ada riwayat sebelumnya."
    lines = []
    for msg in history.messages:
        role = getattr(msg, "type", "unknown")
        content = getattr(msg, "content", "")
        if role == "human":
            prefix = "[Siswa]"
        elif role == "ai":
            prefix = "[Tutor]"
        else:
            prefix = "[Riwayat]"
        lines.append(f"{prefix} {content}")
    text = "\n".join(lines)
    if len(text) <= max_chars:
        return text
    return "...\n" + text[-max_chars:]

# data models
class ChatRequest(BaseModel):
    message: str
    cognitive: Optional[str] = "par"  # "par" atau "tar"
    cq1: Optional[str] = "t"          # "p", "t", "a"
    cq2: Optional[str] = "a"          # "p", "t", "a"
    session_id: Optional[str] = "default"


class EvalRequest(BaseModel):
    answer: str
    correct_answer: str
    wrong_count: Optional[int] = 0
    session_id: Optional[str] = "default"

# ollama wrapper
def _query_ollama_http(prompt: str, retries: int = 3, delay: int = 5) -> str:
    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": False,
    }
    for attempt in range(retries):
        try:
            print(f"[OllamaHTTP] 🚀 Kirim prompt (attempt {attempt + 1}/{retries})")
            r = requests.post(OLLAMA_API_URL, json=payload, timeout=1500)
            if r.status_code == 200:
                try:
                    data = r.json()
                    text = (data.get("response") or "").strip()
                    return text or "[Error] Model tidak mengembalikan jawaban."
                except json.JSONDecodeError:
                    return "[Error] Respons JSON tidak valid."
            elif r.status_code == 500:
                print("[OllamaHTTP] ⚠️ Model belum siap, retry...")
                time.sleep(delay)
                continue
            else:
                print(f"[OllamaHTTP] ⚠️ HTTP {r.status_code}: {r.text[:200]}")
                return f"[Error Ollama API] {r.text[:200]}"
        except requests.exceptions.ConnectionError:
            print("[OllamaHTTP] ❌ Tidak dapat terhubung ke Ollama, retry...")
            time.sleep(delay)
        except requests.exceptions.ReadTimeout:
            print("[OllamaHTTP] ⏱️ Timeout (300 detik).")
            return "[Error Ollama API] Timeout."
        except Exception as e:
            print(f"[OllamaHTTP] ❌ Exception: {e}")
            time.sleep(delay)
    return "[Error Ollama API] Gagal menghubungi Ollama setelah beberapa percobaan."


def query_ollama(prompt: str, retries: int = 3, delay: int = 5) -> str:
    if llm is None:
        return _query_ollama_http(prompt, retries=retries, delay=delay)

    last_error: Optional[Exception] = None
    for attempt in range(retries):
        try:
            print(f"[OllamaLC] 🚀 Kirim prompt (attempt {attempt + 1}/{retries})")
            result = llm.invoke(prompt)
            text = getattr(result, "content", None)
            if not text:
                text = str(result)
            text = (text or "").strip()
            return text or "[Error] Model tidak mengembalikan jawaban."
        except Exception as e:
            last_error = e
            print(f"[OllamaLC] ❌ Exception: {e}")
            time.sleep(delay)

    print("[OllamaLC] ⚠️ Gagal lewat LangChain, fallback HTTP.")
    if last_error:
        print(f"[OllamaLC] Last error: {last_error}")
    return _query_ollama_http(prompt, retries=retries, delay=delay)

# utility for code detection
CODE_REGEX = re.compile(r"```[\s\S]*?```|(\bfor\b|\bwhile\b|\bif\b|\bdef\b|\bprint\b|\breturn\b|;|=)")


def is_code_like(text: str) -> bool:
    return bool(CODE_REGEX.search(text or ""))

# cognitive and cq profile utilities
def cognitive_label(code: str) -> str:
    c = (code or "").lower()
    if c == "par":
        return "PAR — Practical-Analytical"
    if c == "tar":
        return "TAR — Theoretical-Analytical"
    return "Default Cognitive"

def cq_label(code: str) -> str:
    c = (code or "").lower()
    if c == "p":
        return "Praktis / Project"
    if c == "t":
        return "Teoretis / Thinking"
    if c == "a":
        return "Analitis / Abstract"
    return "Tanpa preferensi khusus"

def opposite_cognitive(code: str) -> str:
    c = (code or "").lower()
    if c == "par":
        return "tar"
    if c == "tar":
        return "par"
    return "par"

def balanced_cq_compare(cq1: str, cq2: str):
    """
    Pilih kombinasi CQ untuk profil perbandingan:
    - Ambil CQ yang belum dipakai jika ada
    - Kalau sudah semua dipakai, fallback ke (cq1, cq2)
    """
    all_cq = ["p", "t", "a"]
    used = { (cq1 or "").lower(), (cq2 or "").lower() }
    remaining = [c for c in all_cq if c not in used]
    if not remaining:
        return (cq1 or "t"), (cq2 or "a")
    cq_comp1 = remaining[0]
    # cq_comp2 boleh salah satu yang sudah ada atau cq_comp1 lagi
    cq_comp2 = cq1 or remaining[0]
    return cq_comp1, cq_comp2

# chat endpoint
@app.post("/chat")
def chat_endpoint(req: ChatRequest):
    """
    Chat utama:
    - Profil utama: cognitive_main (par/tar) + cq1_main + cq2_main
    - Profil perbandingan: kebalikan cognitive + CQ seimbang
    - Menggunakan RAG + memory + follow-up question
    """
    session_id = req.session_id or "default"
    history = get_session_history(session_id)

    print("\n==============================")
    print(f"[CHAT] Pertanyaan: {req.message}")
    print(f"[CHAT] Cognitive: {req.cognitive}, CQ1={req.cq1}, CQ2={req.cq2}")
    print(f"[CHAT] Session ID: {session_id}")
    print("==============================")

    # profil utama
    cognitive_main = (req.cognitive or "par").lower()
    if cognitive_main not in ["par", "tar"]:
        cognitive_main = "par"

    cq1_main = (req.cq1 or "t").lower()
    cq2_main = (req.cq2 or "a").lower()

    # profil perbandingan
    cognitive_compare = opposite_cognitive(cognitive_main)
    cq1_compare, cq2_compare = balanced_cq_compare(cq1_main, cq2_main)

    # label
    cognitive_main_label = cognitive_label(cognitive_main)
    cognitive_compare_label = cognitive_label(cognitive_compare)
    cq1_main_label = cq_label(cq1_main)
    cq2_main_label = cq_label(cq2_main)
    cq1_compare_label = cq_label(cq1_compare)
    cq2_compare_label = cq_label(cq2_compare)

    # rag
    load_materials_and_build_index()
    rag_chunks = retrieve_relevant_chunks(req.message, k=4)
    context_parts = []
    for i, ch in enumerate(rag_chunks, start=1):
        chunk_text = ch["text"][:RAG_CHUNK_MAX_CHARS]
        context_parts.append(f"[Sumber {i} - {ch['source']}]\n{chunk_text}\n")
    context_text = "\n\n".join(context_parts) if context_parts else "Tidak ada konteks materi relevan ditemukan."
    used_rag = bool(rag_chunks)

    # history ringkas
    history_text = format_history_as_text(history)

    # deteksi code question
    code_question = is_code_like(req.message)

    # prompt utama
    if code_question:
        prompt_main = (
            f"Kamu adalah tutor Computational Thinking dengan profil kognitif utama "
            f"'{cognitive_main_label}' dan preferensi '{cq1_main_label}' serta '{cq2_main_label}'.\n\n"
            f"=== RINGKASAN RIWAYAT SEBELUMNYA ===\n{history_text}\n\n"
            f"=== KONTEN MATERI TERKAIT (RAG) ===\n{context_text}\n\n"
            f"Analisis pertanyaan/logika/kode berikut:\n\n"
            f"{req.message}\n\n"
            f"Berikan penjelasan yang menekankan pemahaman konsep, logika, dan langkah berpikir "
            f"sesuai profil kognitif ini. JANGAN memberikan jawaban final atau kode lengkap secara eksplisit. "
            f"Bimbing siswa agar dapat menemukan jawabannya sendiri."
        )
        prompt_compare = (
            f"Kamu adalah tutor Computational Thinking VERSI PERBANDINGAN, dengan profil kognitif "
            f"'{cognitive_compare_label}' dan preferensi '{cq1_compare_label}' serta '{cq2_compare_label}'.\n\n"
            f"=== KONTEN MATERI TERKAIT (RAG) ===\n{context_text}\n\n"
            f"Pertanyaan/logika/kode siswa:\n{req.message}\n\n"
            f"Buat versi penjelasan alternatif yang tetap benar namun menonjolkan cara berpikir "
            f"sesuai profil perbandingan ini. Jangan membocorkan jawaban final; fokus pada pendekatan berpikir."
        )
    else:
        prompt_main = (
            f"Kamu adalah tutor dengan profil kognitif utama '{cognitive_main_label}' dan preferensi "
            f"'{cq1_main_label}' serta '{cq2_main_label}'.\n\n"
            f"=== RINGKASAN RIWAYAT SEBELUMNYA ===\n{history_text}\n\n"
            f"=== KONTEN MATERI TERKAIT (RAG) ===\n{context_text}\n\n"
            f"Berikan penjelasan yang mudah dipahami, terstruktur, dan sesuai dengan profil kognitif tersebut "
            f"untuk pertanyaan berikut:\n\n"
            f"{req.message}\n\n"
            f"Jangan berikan jawaban final langsung. Fokuslah pada pemahaman konsep, ilustrasi, dan ajakan "
            f"agar siswa menyimpulkan sendiri."
        )
        prompt_compare = (
            f"Kamu adalah tutor VERSI PERBANDINGAN, dengan profil kognitif '{cognitive_compare_label}' dan "
            f"preferensi '{cq1_compare_label}' serta '{cq2_compare_label}'.\n\n"
            f"=== KONTEN MATERI TERKAIT (RAG) ===\n{context_text}\n\n"
            f"Buat versi penjelasan lain untuk pertanyaan yang sama:\n\n{req.message}\n\n"
            f"Penjelasan ini harus benar namun menonjolkan cara berpikir yang kontras namun saling melengkapi "
            f"dengan profil utama. Jangan bocorkan jawaban final."
        )

    reply_main = query_ollama(prompt_main)
    reply_compare = query_ollama(prompt_compare)

    # follow-up
    followup_prompt = (
        f"Kamu adalah tutor interaktif.\n\n"
        f"=== RINGKASAN RIWAYAT SEBELUMNYA ===\n{history_text}\n\n"
        f"Jawaban penjelasan yang baru saja kamu berikan:\n\n"
        f"{reply_main}\n\n"
        f"Buat SATU pertanyaan lanjutan (tepat 1 kalimat) untuk mengajak siswa berpikir lebih dalam. "
        f"Hindari memberi jawaban; fokus pada konsep atau aplikasinya."
    )
    followup_question = query_ollama(followup_prompt).strip()

    # update memory
    if history is not None:
        history.add_user_message(req.message)
        history.add_ai_message(reply_main)

    # simpan log global
    conversation_entry = {
        "user_message": req.message,
        "cognitive_main": cognitive_main_label,
        "cq1_main": cq1_main_label,
        "cq2_main": cq2_main_label,
        "cognitive_compare": cognitive_compare_label,
        "cq1_compare": cq1_compare_label,
        "cq2_compare": cq2_compare_label,
        "reply_main": reply_main,
        "reply_compare": reply_compare,
        "followup_question": followup_question,
        "is_code_question": code_question,
        "used_rag": used_rag,
        "rag_sources": [
            {"source": ch["source"], "score": ch["score"]}
            for ch in rag_chunks
        ],
        "session_id": session_id,
    }
    conversation_history.append(conversation_entry)
    print(f"[CHAT] 💾 Riwayat disimpan (total {len(conversation_history)} percakapan).")

    return {
        "cognitive_main": cognitive_main_label,
        "cq1_main": cq1_main_label,
        "cq2_main": cq2_main_label,
        "cognitive_compare": cognitive_compare_label,
        "cq1_compare": cq1_compare_label,
        "cq2_compare": cq2_compare_label,
        "reply_main": reply_main,
        "reply_compare": reply_compare,
        "followup_question": followup_question,
        "is_code_question": code_question,
        "used_rag": used_rag,
        "session_id": session_id,
    }

# eval endpoint
@app.post("/evaluate")
def evaluate_answer(req: EvalRequest):
    print("[EVALUASI] 🧠 Mode evaluasi adaptif aktif")
    wrong_count = req.wrong_count or 0
    answer = (req.answer or "").strip()
    is_code = is_code_like(answer)
    session_id = req.session_id or "default"
    history = get_session_history(session_id)

    if wrong_count == 0:
        hint_level = "Evaluasi awal."
        followup_role = "ajukan 1 pertanyaan sederhana untuk menguji pemahaman dasar."
    elif wrong_count == 1:
        hint_level = "Directive Hint: petunjuk singkat & spesifik."
        followup_role = "ajukan 1 pertanyaan penuntun yang mengarah ke inti konsep."
    elif wrong_count == 2:
        hint_level = "Remedial Scaffold: contoh sepadan + langkah kecil."
        followup_role = "ajukan pertanyaan lanjutan berbasis analogi atau langkah kecil."
    else:
        hint_level = "Facilitative Step-by-Step Guide: panduan terstruktur namun tetap tidak membocorkan jawaban."
        followup_role = "ajakan refleksi agar siswa menyusun kembali pemahamannya."

    load_materials_and_build_index()
    rag_query = f"{req.correct_answer}\n\nJawaban siswa:\n{req.answer}"
    rag_chunks = retrieve_relevant_chunks(rag_query, k=4)
    context_parts = []
    for i, ch in enumerate(rag_chunks, start=1):
        chunk_text = ch["text"][:RAG_CHUNK_MAX_CHARS]
        context_parts.append(f"[Sumber {i} - {ch['source']}]\n{chunk_text}\n")
    context_text = "\n\n".join(context_parts) if context_parts else "Tidak ada konteks materi relevan ditemukan."
    used_rag = bool(rag_chunks)

    history_text = format_history_as_text(history)

    if is_code:
        prompt_eval = (
            f"Kamu adalah tutor Computational Thinking.\n\n"
            f"=== RIWAYAT EVALUASI SEBELUMNYA (ringkas) ===\n{history_text}\n\n"
            f"=== KONTEN MATERI TERKAIT (RAG) ===\n{context_text}\n\n"
            f"Evaluasi logika, struktur, dan kejelasan kode/pseudocode berikut.\n\n"
            f"Jawaban siswa:\n{req.answer}\n\n"
            f"Kunci jawaban (rujukan konsep):\n{req.correct_answer}\n\n"
            f"Tahap bantuan: {hint_level}\n"
            f"Berikan umpan balik ringkas, fokus ke algoritma & urutan langkah, bukan sekadar sintaks. "
            f"Jika salah, JANGAN memberikan jawaban final — beri petunjuk bertahap."
        )
    else:
        prompt_eval = (
            f"Kamu adalah tutor adaptif.\n\n"
            f"=== RIWAYAT EVALUASI SEBELUMNYA (ringkas) ===\n{history_text}\n\n"
            f"=== KONTEN MATERI TERKAIT (RAG) ===\n{context_text}\n\n"
            f"Evaluasi jawaban siswa berdasarkan kunci jawaban berikut.\n\n"
            f"Jawaban siswa:\n{req.answer}\n\n"
            f"Kunci jawaban:\n{req.correct_answer}\n\n"
            f"Tahap bantuan: {hint_level}\n"
            f"Berikan umpan balik mendidik dan petunjuk bertahap. Jangan bocorkan jawaban final jika salah."
        )

    feedback = query_ollama(prompt_eval)
    is_correct_flag = "benar" in feedback.lower() and "salah" not in feedback.lower()

    followup_prompt = (
        f"Kamu adalah tutor interaktif.\n\n"
        f"=== RIWAYAT EVALUASI SEBELUMNYA (ringkas) ===\n{history_text}\n\n"
        f"Jawaban siswa:\n{req.answer}\n\n"
        f"Kunci konsep:\n{req.correct_answer}\n\n"
        f"Pada tahap: {hint_level}, {followup_role} "
        f"Tepat 1 kalimat. Jangan berikan jawaban langsung."
    )
    followup_question = query_ollama(followup_prompt).strip()

    if history is not None:
        history.add_user_message(f"[EVALUASI] Jawaban: {req.answer}")
        history.add_ai_message(f"[UMPAN BALIK] {feedback.strip()}")

    return {
        "is_correct": is_correct_flag,
        "feedback": feedback.strip(),
        "hint_level": hint_level,
        "is_code": is_code,
        "followup_question": followup_question,
        "used_rag": used_rag,
        "session_id": session_id,
    }

# history endpoint
@app.get("/history")
def get_history(format: str = "json"):
    if not conversation_history:
        if format == "json":
            return {"history": []}
        return {"data": "Belum ada percakapan."}

    if format == "json":
        return {"history": conversation_history}

    text_data = ""
    for i, conv in enumerate(conversation_history, start=1):
        text_data += f"[Percakapan {i}]\n"
        text_data += f"Pertanyaan: {conv['user_message']}\n"
        text_data += f"Cognitive utama: {conv['cognitive_main']} (CQ: {conv['cq1_main']}, {conv['cq2_main']})\n"
        text_data += f"Perbandingan: {conv['cognitive_compare']} (CQ: {conv['cq1_compare']}, {conv['cq2_compare']})\n"
        text_data += f"Jawaban utama:\n{conv['reply_main']}\n"
        text_data += f"Jawaban perbandingan:\n{conv['reply_compare']}\n"
        if conv.get("followup_question"):
            text_data += f"Pertanyaan Lanjutan: {conv['followup_question']}\n"
        text_data += "-" * 60 + "\n"
    return {"data": text_data}

# main dev server
if __name__ == "__main__":
    import uvicorn

    print("\n🚀 Menjalankan server di http://127.0.0.1:8000")
    print(f"🔌 Ollama API: {OLLAMA_API_URL}")
    print(f"🧠 Model utama: {MODEL_NAME}")
    print(f"📚 Folder materi (RAG): {MATERIALS_DIR}")
    print(f"🧠 Embedding model: {EMBEDDING_MODEL_NAME}")
    uvicorn.run("ollamaapi:app", host="127.0.0.1", port=8000, reload=True)
