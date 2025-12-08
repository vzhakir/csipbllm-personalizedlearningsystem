from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any, Tuple
from http import HTTPStatus 
import os
import re

# Import modular components - Menggunakan Impor Relatif
from .config import (
    BASE_DIR, STATIC_DIR, MAX_HISTORY_CHARS, 
    cognitive_label, cq_label, opposite_cognitive, balanced_cq_compare, 
    is_code_like, FEW_SHOT_EXAMPLE
)
from .llm_service import query_ollama, get_ollama_status
from .rag_service import (
    load_materials_and_build_index, retrieve_relevant_chunks, 
    build_context_with_crag
)

# Import optional LangChain components untuk Memory
try:
    from langchain_community.chat_message_histories import ChatMessageHistory
except ImportError:
    ChatMessageHistory = None  # type: ignore

# ================================================================
# FASTAPI SETUP
# ================================================================
app = FastAPI(title="CSIPBLLM - Kognitif + RAG (FastAPI)")
router = APIRouter()

# Static Files
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse({"error": "index.html tidak ditemukan"}, status_code=HTTPStatus.NOT_FOUND.value)

@app.get("/status")
def get_status():
    """Checks if Ollama LLM is responsive."""
    return get_ollama_status()

# ================================================================
# MEMORY & DATA MODELS
# ================================================================
session_histories: Dict[str, Any] = {}
conversation_history: List[Dict] = []

class ChatRequest(BaseModel):
    message: str = Field(alias="question")
    cognitive: Optional[str] = "par"  # "par" atau "tar"
    cq1: Optional[str] = "t"          # "p", "t", "a"
    cq2: Optional[str] = "a"          # "p", "t", "a"
    session_id: Optional[str] = "default"
    mode: Optional[str] = "accurate"  # "fast" atau "accurate" (untuk CRAG-lite)
    prompt_style: Optional[str] = "zero_shot" # "zero_shot", "cot", "few_shot"

class EvalRequest(BaseModel):
    answer: str = Field(alias="user_answer")
    correct_answer: str
    wrong_count: Optional[int] = 0
    session_id: Optional[str] = "default"


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
        if role == "human": prefix = "[Siswa]"
        elif role == "ai": prefix = "[Tutor]"
        else: prefix = "[Riwayat]"
        lines.append(f"{prefix} {content}")
    text = "\n".join(lines)
    if len(text) <= max_chars:
        return text
    return "...\n" + text[-max_chars:]

# ================================================================
# UTILITAS METAKOGNISI
# ================================================================
def _parse_ollama_sections(text: str, section_name: str, default: str = "") -> str:
    """Helper untuk mengambil konten dari format FEEDBACK: [...] dan FOLLOWUP_QUESTION: [...]"""
    pattern = re.compile(rf"^{re.escape(section_name)}:\s*(.*?)(?:\n---|\n[A-Z_]+:|$)", re.DOTALL | re.MULTILINE)
    match = pattern.search(text)
    if match:
        return match.group(1).strip()
    return default

def _get_reflection_prompt(user_answer: str, history_text: str, wrong_count: int) -> str:
    """Menghasilkan prompt untuk mendorong refleksi metakognitif."""
    return f"""
    SYSTEM: Anda adalah seorang tutor yang fokus pada metakognisi. Siswa telah berhasil menjawab pertanyaan.
    
    Riwayat Scaffolding yang Diberikan (Ringkas):
    {history_text}
    
    Siswa mencapai jawaban yang benar ({user_answer}) setelah {wrong_count} kali percobaan salah dan menerima petunjuk.
    
    Tugas Anda adalah:
    1. Berikan pujian dan konfirmasi bahwa jawaban siswa adalah BENAR dan sudah final.
    2. Abaikan semua riwayat petunjuk scaffolding sebelumnya, dan fokus pada akhir proses.
    3. Dorong siswa untuk merefleksikan proses mereka, BUKAN menjawab soal baru.
    4. Ajukan satu pertanyaan reflektif yang memaksa siswa menjelaskan PERUBAHAN strategi, pemahaman, atau kesalahan kritis apa yang baru mereka sadari yang membuat jawaban ini benar.
       
    Format Output (Harus dipisahkan dengan garis ---):
    FEEDBACK: [Pujian dan konfirmasi jawaban benar, maksimal 2 kalimat]
    ---
    FOLLOWUP_QUESTION: [Satu pertanyaan reflektif tentang proses belajar/perubahan strategi]
    """

# ================================================================
# ENDPOINT CHAT (Optimasi: Fokus pada Personalisasi & Gaya Prompting)
# ================================================================
@router.post("/chat")
def chat_endpoint(req: ChatRequest):
    session_id = req.session_id or "default"
    history = get_session_history(session_id)

    # 1. Setup Profil Kognitif
    cognitive_main = (req.cognitive or "par").lower()
    if cognitive_main not in ["par", "tar"]: cognitive_main = "par"
    cq1_main = (req.cq1 or "t").lower()
    cq2_main = (req.cq2 or "a").lower()
    cognitive_compare = opposite_cognitive(cognitive_main)
    cq1_compare, cq2_compare = balanced_cq_compare(cq1_main, cq2_main)
    
    cognitive_main_label = cognitive_label(cognitive_main)
    
    # 2. Prompt Style
    prompt_style = (req.prompt_style or "zero_shot").lower()
    style_injection_prefix = ""
    if prompt_style == "cot":
        # Instruksi CoT lebih ringkas
        style_injection_prefix = "MULAILAH jawabanmu dengan 'Mari kita pikirkan ini langkah demi langkah.' Tunjukkan penalaran internalmu (langkah berpikir) sebelum memberikan jawaban. "
    elif prompt_style == "few_shot":
        style_injection_prefix = FEW_SHOT_EXAMPLE + "\n\nIkuti format penalaran yang sama dengan contoh di atas. "

    # 3. RAG + CRAG-lite
    load_materials_and_build_index() 
    rag_chunks = retrieve_relevant_chunks(req.message, k=4)
    context_text, used_rag, rag_mode, rag_sources = build_context_with_crag(
        req.message, rag_chunks, mode=(req.mode or "accurate")
    )
    history_text = format_history_as_text(history)
    code_question = is_code_like(req.message)

    # 4. Building Prompts 
    
    # Instruksi Kognitif dan RAG disatukan untuk efisiensi prompt
    base_instr = (
        "Gunakan profil ini untuk mengatur gaya penjelasan: "
        "PAR → praktis & banyak contoh konkret; "
        "TAR → konseptual & teoritis sebelum contoh. "
        "Jawab dalam BAHASA INDONESIA yang jelas dan sopan. "
        "JANGAN BERIKAN JAWABAN AKHIR SECARA LANGSUNG, ajak siswa merumuskan sendiri.\n"
    )
    
    profile_meta = (
        f"Profil Utama Siswa:\n"
        f"- Kognitif: {cognitive_label(cognitive_main)}\n"
        f"- CQ1: {cq_label(cq1_main)}, CQ2: {cq_label(cq2_main)}\n\n"
    )
    
    # Prompt Utama
    prompt_main = (
        f"Kamu adalah tutor pembelajaran PERSONAL yang adaptif ({'Computational Thinking' if code_question else 'Konseptual'}).\n\n"
        f"{profile_meta}"
        f"=== INSTRUKSI PROMPT KHUSUS ({prompt_style.upper()}) ===\n{style_injection_prefix}"
        f"=== RINGKASAN RIWAYAT SEBELUMNYA ===\n{history_text}\n\n"
        f"=== KONTEN MATERI TERKAIT (RAG, mode={rag_mode}) ===\n{context_text}\n\n"
        f"Tugasmu: {base_instr}\n"
    )
    if code_question:
        prompt_main += "Fokus pada konsep dasar dan strategi penyelesaiannya secara bertahap. JANGAN PERNAH MEMBERIKAN KODE/JAWABAN AKHIR SECARA LENGKAP.\n"
    else:
        prompt_main += "Fokus pada konsep, kerangka teori, dan analogi yang relevan.\n"
    
    prompt_main += f"Pertanyaan Siswa:\n{req.message}\n"


    # Prompt Perbandingan (Tidak perlu CoT/Few-Shot, tetap ringkas)
    prompt_compare = (
        f"Kamu adalah tutor VERSI PERBANDINGAN yang memberikan sudut pandang {cognitive_label(cognitive_compare)}.\n\n"
        f"Profil Perbandingan:\n- Kognitif: {cognitive_label(cognitive_compare)}\n- CQ1: {cq_label(cq1_compare)}, CQ2: {cq_label(cq2_compare)}\n\n"
        f"=== KONTEN MATERI TERKAIT (RAG, mode={rag_mode}) ===\n{context_text}\n\n"
        "Buat penjelasan ALTERNATIF, tetap benar, tetapi sesuaikan gaya berpikir dengan profil perbandingan. Jangan hanya mengulang penjelasan utama.\n\n"
        f"Pertanyaan Siswa:\n{req.message}\n"
    )

    # 5. Eksekusi LLM dan Follow-up
    reply_main, latency_main = query_ollama(prompt_main)
    reply_compare, latency_compare = query_ollama(prompt_compare)

    # Follow-up prompt tetap ringkas
    followup_prompt = (
        f"Kamu adalah tutor interaktif. Buat SATU pertanyaan lanjutan (tepat 1 kalimat) untuk mengajak siswa berpikir lebih dalam berdasarkan penjelasan ini. Hindari memberi jawaban; fokus pada konsep atau aplikasinya.\n\n"
        f"Jawaban penjelasan yang baru saja kamu berikan:\n\n{reply_main}"
    )
    followup_question, _ = query_ollama(followup_prompt, retries=1)
    followup_question = followup_question.strip()

    # 6. Update Memory & Log
    if history is not None:
        history.add_user_message(req.message)
        history.add_ai_message(reply_main)

    conversation_entry = {
        # ... (logging data) ...
        "user_message": req.message,
        "cognitive_main": cognitive_label(cognitive_main),
        "cq1_main": cq_label(cq1_main),
        "cq2_main": cq_label(cq2_main),
        "cognitive_compare": cognitive_label(cognitive_compare),
        "cq1_compare": cq_label(cq1_compare),
        "cq2_compare": cq_label(cq2_compare),
        "reply_main": reply_main,
        "reply_compare": reply_compare,
        "followup_question": followup_question,
        "is_code_question": code_question,
        "used_rag": used_rag,
        "rag_mode": rag_mode,
        "rag_sources": rag_sources,
        "session_id": session_id,
        "prompt_style_main": prompt_style,
        "latency_main_s": latency_main,
        "latency_compare_s": latency_compare,
    }
    conversation_history.append(conversation_entry)
    print(f"[CHAT] 💾 Riwayat disimpan (total {len(conversation_history)} percakapan).")

    return {
        # ... (response data) ...
        "cognitive_main": cognitive_label(cognitive_main),
        "cq1_main": cq_label(cq1_main),
        "cq2_main": cq_label(cq2_main),
        "cognitive_compare": cognitive_label(cognitive_compare),
        "cq1_compare": cq_label(cq1_compare),
        "cq2_compare": cq_label(cq2_compare),
        "reply_main": reply_main,
        "reply_compare": reply_compare,
        "followup_question": followup_question,
        "is_code_question": code_question,
        "used_rag": used_rag,
        "rag_mode": rag_mode,
        "session_id": session_id,
        "latency_main_s": latency_main, 
        "prompt_style_main": prompt_style, 
    }

# ================================================================
# ENDPOINT EVALUASI (Optimasi: Pedagogi Ketat & Anti-Halusinasi)
# ================================================================
@router.post("/evaluate")
def evaluate_answer(req: EvalRequest):
    wrong_count = req.wrong_count or 0
    answer = (req.answer or "").strip()
    is_code = is_code_like(answer)
    session_id = req.session_id or "default"
    history = get_session_history(session_id)
    history_text = format_history_as_text(history)

    # 1. Scaffolding Logic & RAG Context
    if wrong_count == 0: 
        hint_level = "Directive Hint: petunjuk singkat & spesifik (Wrong once)."
        followup_role = "ajukan 1 pertanyaan penuntun yang mengarah ke inti konsep."
    elif wrong_count == 1: 
        hint_level = "Remedial Scaffold: contoh sepadan + langkah kecil (Wrong twice)."
        followup_role = "ajukan pertanyaan lanjutan berbasis analogi atau langkah kecil."
    elif wrong_count >= 2: 
        hint_level = "Facilitative Step-by-Step Guide: panduan terstruktur namun tetap tidak membocorkan jawaban (Wrong three times+)."
        followup_role = "ajakan refleksi agar siswa menyusun kembali pemahamannya."
    
    rag_query = f"{req.correct_answer}\n\nJawaban siswa:\n{req.answer}"
    load_materials_and_build_index()
    rag_chunks = retrieve_relevant_chunks(rag_query, k=4)
    context_parts = []
    for i, ch in enumerate(rag_chunks, start=1):
        chunk_text = (ch.get("summary") or ch["text"])[:200]
        context_parts.append(f"[Sumber {i} - {ch['source']}]\n{chunk_text}\n")
    context_text = "\n\n".join(context_parts) if context_parts else "Tidak ada konteks materi relevan ditemukan."

    # 2. LLM Call 1: Evaluasi Jawaban (Prompt Ditingkatkan)
    role_desc = "Computational Thinking" if is_code else "adaptif"
    
    # --- PROMPT EVALUASI DENGAN INSTRUKSI KONSISTENSI LLM ---
    prompt_eval = (
        f"Kamu adalah tutor {role_desc}. Tugasmu adalah memberikan umpan balik yang benar dan mendidik.\n\n"
        f"=== RIWAYAT EVALUASI SEBELUMNYA (ringkas) ===\n{history_text}\n\n"
        f"=== KONTEN MATERI TERKAIT (RAG) ===\n{context_text}\n\n"
        f"Kunci Jawaban (Konsep Referensi):\n{req.correct_answer}\n\n"
        f"Jawaban Siswa:\n{req.answer}\n\n"
        f"Tahap Bantuan Saat Ini: {hint_level}\n"
        
        "--- INSTRUKSI KRUSIAL PEDAGOGI ---\n"
        "1. **Bandingkan** jawaban siswa dengan Kunci Jawaban. Berikan umpan balik apakah jawaban mereka 'BENAR' atau 'SALAH'.\n"
        "2. Jika jawaban SALAH, berikan **HANYA** petunjuk (scaffolding) yang sesuai dengan 'Tahap Bantuan'.\n"
        "3. **JANGAN PERNAH** memberikan jawaban final atau kode lengkap jika jawaban SALAH.\n"
        "4. **JAGA AKURASI MUTLAK:** Jika Anda menggunakan contoh baru (misalnya deret, perhitungan), pastikan semua perhitungan di dalamnya SANGAT akurat dan konsisten dengan rumus yang Anda ajarkan. Jangan berhalusinasi atau mengubah angka di tengah penjelasan. Konsistensi adalah kunci belajar.\n"
        "Jawab dalam BAHASA INDONESIA yang jelas."
    )
    # --- AKHIR PROMPT EVALUASI ---
    
    if is_code:
        prompt_eval = prompt_eval.replace("Evaluasi jawaban siswa", "Evaluasi logika, struktur, dan kejelasan kode/pseudocode berikut.")
        
    feedback, _ = query_ollama(prompt_eval, retries=1) 
    feedback = feedback.strip()
    is_correct_flag = "benar" in feedback.lower() and "salah" not in feedback.lower()

    followup_question = ""
    
    # 3. LOGIKA METAKOGNISI / SCAFFOLDING
    if is_correct_flag and wrong_count > 0:
        # Metakognisi (Refleksi Pasca-Koreksi)
        reflection_prompt = _get_reflection_prompt(answer, history_text, wrong_count)
        reflection_response, _ = query_ollama(reflection_prompt, retries=1)
        
        feedback_ref = _parse_ollama_sections(reflection_response, "FEEDBACK", default="Jawaban Anda benar.")
        followup_q_ref = _parse_ollama_sections(reflection_response, "FOLLOWUP_QUESTION", default="Materi sudah dikuasai.")
        
        feedback = f"✅ **{feedback_ref}**\n\n**TINDAK LANJUT REFLEKSI:** {followup_q_ref}"
        hint_level = f"Correct - Reflection (Setelah {wrong_count+1} percobaan)"
        followup_question = "Sekarang, jelaskan perubahan strategi atau kesalahan kunci yang Anda sadari sehingga membuat jawaban ini benar."

    elif not is_correct_flag:
        # Scaffolding (Masih salah)
        followup_prompt = (
            f"Kamu adalah tutor interaktif. Tugasmu adalah {followup_role}. Tepat 1 kalimat. Jangan berikan jawaban langsung.\n\n"
            f"=== RIWAYAT EVALUASI SEBELUMNYA (ringkas) ===\n{history_text}\n\n"
            f"Jawaban siswa:\n{req.answer}\n\n"
            f"Kunci konsep:\n{req.correct_answer}\n"
        )
        followup_question, _ = query_ollama(followup_prompt, retries=1) 
        followup_question = followup_question.strip()
    
    else:
        # Jawaban benar pertama kali (wrong_count == 0)
        hint_level = "Correct - First Try"
        followup_question = "🎉 Anda langsung berhasil menjawab dengan benar! Materi ini sudah Anda kuasai. Anda bisa melanjutkan ke pertanyaan baru."


    # 4. Update Memory
    if history is not None:
        history.add_user_message(f"[EVALUASI] Jawaban: {req.answer}")
        history.add_ai_message(f"[UMPAN BALIK] {feedback.strip()}")

    return {
        "is_correct": is_correct_flag,
        "feedback": feedback.strip(),
        "hint_level": hint_level,
        "is_code": is_code,
        "followup_question": followup_question,
        "used_rag": bool(rag_chunks), 
        "session_id": session_id,
    }


# ================================================================
# ENDPOINT RIWAYAT
# ================================================================
@router.get("/history")
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
        text_data += (
            f"Cognitive utama: {conv['cognitive_main']} "
            f"(CQ: {conv['cq1_main']}, {conv['cq2_main']})\n"
        )
        text_data += (
            f"Prompt Style Utama: {conv.get('prompt_style_main', 'zero_shot').upper()} "
            f"(Latensi: {conv.get('latency_main_s', 0):.2f} detik)\n"
        )
        text_data += (
            f"Perbandingan: {conv['cognitive_compare']} "
            f"(CQ: {conv['cq1_compare']}, {conv['cq2_compare']}) "
            f"(Latensi: {conv.get('latency_compare_s', 0):.2f} detik)\n"
        )
        text_data += f"Jawaban utama:\n{conv['reply_main']}\n"
        text_data += f"Jawaban perbandingan:\n{conv['reply_compare']}\n"
        if conv.get("followup_question"):
            text_data += f"Pertanyaan Lanjutan: {conv['followup_question']}\n"
        if conv.get("used_rag"):
            text_data += f"RAG: Ya (mode={conv.get('rag_mode', 'simple')})\n"
            if conv.get("rag_sources"):
                text_data += "Sumber RAG:\n"
                for src in conv["rag_sources"]:
                    text_data += f"- {src.get('source')} (score={src.get('score'):.2f})\n"
        else:
            text_data += "RAG: Tidak digunakan atau tidak relevan.\n"
        text_data += "-" * 60 + "\n"
    return {"data": text_data}


# Attach the router to the main app
app.include_router(router)

# ================================================================
# MAIN DEV SERVER
# ================================================================
if __name__ == "__main__":
    import uvicorn
    # Impor Relatif untuk logging di console
    from .llm_service import MODEL_NAME, OLLAMA_API_URL 
    from .rag_service import EMBEDDING_MODEL_NAME, MATERIALS_DIR, ENABLE_CRAG_EVALUATOR, ENABLE_CHUNK_COMPRESSION 
    
    print("\n🚀 Menjalankan server di http://127.0.0.1:8000")
    print(f"🔌 Ollama API: {OLLAMA_API_URL}")
    print(f"🧠 Model utama: {MODEL_NAME}")
    print(f"📚 Folder materi (RAG): {MATERIALS_DIR}")
    print(f"🧠 Embedding model: {EMBEDDING_MODEL_NAME}")
    print(f"⚙️ CRAG-lite aktif: {ENABLE_CRAG_EVALUATOR}")
    print(f"⚙️ Chunk compression aktif: {ENABLE_CHUNK_COMPRESSION}")
    # Perintah Uvicorn: menggunakan nama file baru "ollamaapi:app"
    uvicorn.run("ollamaapi:app", host="127.0.0.1", port=8000, reload=True)
