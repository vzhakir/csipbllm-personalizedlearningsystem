import os
import re
import numpy as np
import json
import faiss # type: ignore
from typing import List, Dict, Any, Tuple, Optional
from .config import ( # <-- Impor Relatif
    EMBEDDING_MODEL_NAME, MATERIALS_DIR, EMBED_CACHE_PATH,
    RAG_CHUNK_MAX_CHARS, ENABLE_CHUNK_COMPRESSION,
    ENABLE_CRAG_EVALUATOR, CRAG_NO_RAG_THRESHOLD, 
    CRAG_KEEP_THRESHOLD, CRAG_TOP_K
)
from .llm_service import query_ollama, _query_ollama_http, base_ollama_url # <-- Impor Relatif

# Import optional LangChain components
try:
    from langchain_ollama import OllamaEmbeddings
except ImportError:
    OllamaEmbeddings = None    # type: ignore

# ================================================================
# RAG GLOBALS
# ================================================================
materials_index: List[Dict] = []
materials_loaded = False
embeddings_model: Any = None
faiss_index: Any = None

# Inisialisasi model embedding
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
    """Memuat materi, chunking, embedding, dan membangun index FAISS/cache."""
    global materials_loaded, materials_index

    if materials_loaded:
        return

    if embeddings_model is None:
        materials_loaded = True
        print("[RAG] ❌ Embeddings tidak tersedia; RAG dimatikan.")
        return

    if not os.path.isdir(MATERIALS_DIR):
        materials_loaded = True
        print("[RAG] ℹ️ Folder materials tidak ditemukan.")
        return

    # Coba load cache (logic dipersingkat, fitur tetap sama)
    if os.path.exists(EMBED_CACHE_PATH):
        try:
            print(f"[RAG] 🔄 Memuat index dari cache: {EMBED_CACHE_PATH}")
            loaded = np.load(EMBED_CACHE_PATH, allow_pickle=True)
            materials_index = loaded.tolist()
            # Normalisasi dan perbaikan struktur cache lama
            for item in materials_index:
                v = np.array(item["embedding"], dtype="float32")
                norm = np.linalg.norm(v)
                if norm != 0: item["embedding"] = v / norm
                if "summary" not in item: item["summary"] = item.get("text", "")[:RAG_CHUNK_MAX_CHARS]
            build_faiss_index()
            materials_loaded = True
            print(f"[RAG] ✅ Index dimuat dari cache ({len(materials_index)} chunk).")
            return
        except Exception as e:
            print(f"[RAG] ⚠️ Gagal load cache, rebuild index: {e}")

    print(f"[RAG] 🔍 Membangun index RAG dari folder: {MATERIALS_DIR}")
    for root, _, files in os.walk(MATERIALS_DIR):
        for fname in files:
            if not fname.lower().endswith((".txt", ".md")): continue
            path = os.path.join(root, fname)
            try:
                with open(path, "r", encoding="utf-8") as f: text = f.read().strip()
            except Exception as e:
                print(f"[RAG] ⚠️ Gagal baca {path}: {e}"); continue

            if not text: continue
            
            # Chunking dasar
            chunks = [text[i:i + 800] for i in range(0, len(text), 800)]
            
            for idx, chunk in enumerate(chunks):
                try:
                    emb = np.array(embeddings_model.embed_query(chunk), dtype="float32")
                except Exception as e:
                    print(f"[RAG] ⚠️ Gagal embed chunk {fname}#{idx}: {e}"); continue

                # Normalisasi
                norm = np.linalg.norm(emb)
                if norm != 0: emb = emb / norm

                summary_text = chunk[:RAG_CHUNK_MAX_CHARS]
                
                # CHUNK COMPRESSION (Fitur tetap ada)
                if ENABLE_CHUNK_COMPRESSION:
                    try:
                        from_text = chunk[:1200]
                        summary_prompt = (
                            "Ringkas teks materi berikut menjadi 2–3 kalimat inti "
                            "yang fokus pada konsep dan langkah penting untuk belajar "
                            "Computational Thinking. Hindari detail yang tidak penting.\n\n"
                            f"{from_text}"
                        )
                        summary_resp = _query_ollama_http(summary_prompt, retries=1)
                        if summary_resp and not summary_resp.startswith("[Error"):
                            summary_text = summary_resp.strip()
                    except Exception as e:
                        print(f"[RAG] ⚠️ Error saat kompres chunk {fname}#{idx}: {e}")

                materials_index.append(
                    {
                        "embedding": emb, "text": chunk, "summary": summary_text,
                        "source": fname, "chunk_id": idx,
                    }
                )

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
    if norm != 0: q_emb = q_emb / norm

    results: List[Dict] = []

    # FAISS search
    if faiss_index is not None:
        try:
            D, I = faiss_index.search(q_emb.reshape(1, -1).astype("float32"), k)
            idxs = I[0]
            scores = D[0]
            for idx, score in zip(idxs, scores):
                if idx < 0 or score <= 0: continue
                item = materials_index[int(idx)]
                results.append(
                    {
                        "text": item["text"], "summary": item.get("summary") or item["text"],
                        "source": item["source"], "score": float(score),
                    }
                )
            return results
        except Exception as e:
            print(f"[RAG] ⚠️ FAISS error, fallback NumPy: {e}")

    # NumPy fallback
    scores = [float(np.dot(q_emb, item["embedding"])) for item in materials_index]
    if not scores: return []
    idxs = np.argsort(scores)[::-1][:k]
    
    for i in idxs:
        score = scores[i]
        if score <= 0: continue
        item = materials_index[i]
        results.append(
            {
                "text": item["text"], "summary": item.get("summary") or item["text"],
                "source": item["source"], "score": float(score),
            }
        )
    return results

# ================================================================
# CRAG-LITE: EVALUATOR RELEVANSI RAG
# ================================================================

def _parse_scores_from_text(text: str, n: int) -> List[float]:
    """Coba ambil list skor dari output model (format JSON)."""
    text = (text or "").strip()
    scores: Optional[List[Any]] = None

    try:
        obj = json.loads(text)
        cand = obj.get("scores")
        if isinstance(cand, list):
            scores = cand
    except Exception:
        for m in re.findall(r"\{.*?\}", text, flags=re.DOTALL):
            try:
                obj = json.loads(m)
                cand = obj.get("scores")
                if isinstance(cand, list):
                    scores = cand
            except Exception:
                continue

    if scores is None:
        return [0.5] * n

    out: List[float] = []
    for s in scores[:n]:
        try:
            out.append(float(s))
        except Exception:
            out.append(0.0)

    while len(out) < n:
        out.append(0.0)
    return out[:n]


def build_context_with_crag(query: str, rag_chunks: List[Dict], mode: str = "accurate"):
    """
    Bangun context_text untuk RAG dengan/tanpa CRAG-lite.
    Return: context_text, used_rag (bool), rag_mode (str), rag_sources (list)
    """
    if not rag_chunks:
        return "Tidak ada konteks materi relevan ditemukan.", False, "no_material", []

    # Simple mode (tanpa evaluator)
    if (mode or "accurate").lower() != "accurate" or not ENABLE_CRAG_EVALUATOR:
        context_parts = []
        rag_sources = []
        for i, ch in enumerate(rag_chunks, start=1):
            chunk_text = (ch.get("summary") or ch.get("text") or "")[:RAG_CHUNK_MAX_CHARS]
            context_parts.append(f"[Sumber {i} - {ch.get('source', '?')}]\n{chunk_text}\n")
            rag_sources.append({"source": ch.get("source", "?"), "score": float(ch.get("score", 0.0))})
        context_text = "\n\n".join(context_parts) if context_parts else "Tidak ada konteks materi relevan ditemukan."
        return context_text, True, "simple", rag_sources

    # CRAG-lite evaluator
    n = len(rag_chunks)
    chunk_sections = [
        f"Chunk {i}:\n{(ch.get('summary') or ch.get('text') or '')[:RAG_CHUNK_MAX_CHARS]}\n"
        for i, ch in enumerate(rag_chunks, start=1)
    ]

    eval_prompt = (
        "Kamu adalah evaluator relevansi materi belajar.\n\n"
        f"Pertanyaan siswa:\n{query}\n\n"
        "Berikut beberapa potongan materi (chunk). Nilai seberapa relevan masing-masing chunk "
        "untuk membantu menjawab pertanyaan di atas, pada skala 0 sampai 1 "
        "(0 = tidak relevan, 1 = sangat relevan).\n\n"
        'Kembalikan hasil dalam format JSON PERSIS seperti ini (tanpa teks lain):\n{"scores": [s1, s2, ...]}\n\n'
        + "\n".join(chunk_sections)
    )

    try:
        eval_resp, _ = query_ollama(eval_prompt, retries=1) 
        scores = _parse_scores_from_text(eval_resp, n)
        print(f"[CRAG] Skor relevansi: {scores}")
    except Exception as e:
        print(f"[CRAG] ⚠️ Gagal evaluasi RAG: {e}, fallback ke mode simple.")
        return build_context_with_crag(query, rag_chunks, mode="fast")

    max_score = max(scores) if scores else 0.0
    if max_score < CRAG_NO_RAG_THRESHOLD:
        return ("Tidak ada konteks materi yang cukup relevan (hasil RAG ber-konfidensi rendah).", False, "no_rag_low_conf", [])

    indexed = list(enumerate(rag_chunks))
    ranked = sorted(indexed, key=lambda t: scores[t[0]], reverse=True)

    kept: List[Tuple[Dict, float]] = []
    for idx, ch in ranked:
        s = float(scores[idx])
        if s < CRAG_KEEP_THRESHOLD:
            continue
        kept.append((ch, s))
        if len(kept) >= CRAG_TOP_K:
            break

    if not kept:
        # Fallback jika tidak ada yang lolos threshold CRAG
        ctx, used, _, sources = build_context_with_crag(query, rag_chunks, mode="fast")
        return ctx, used, "simple_fallback", sources

    context_parts = []
    rag_sources = []
    for i, (ch, s) in enumerate(kept, start=1):
        chunk_text = (ch.get("summary") or ch.get("text") or "")[:RAG_CHUNK_MAX_CHARS]
        context_parts.append(f"[Sumber {i} - {ch.get('source', '?')} | skor={s:.2f}]\n{chunk_text}\n")
        rag_sources.append({"source": ch.get("source", "?"), "score": float(s)})

    context_text = "\n\n".join(context_parts)
    return context_text, True, "crag_filtered", rag_sources
