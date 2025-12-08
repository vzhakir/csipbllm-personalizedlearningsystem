import os
import re
from typing import List, Dict, Optional, Any, Tuple

# ================================================================
# KONFIGURASI GLOBAL
# ================================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__)) 
STATIC_DIR = os.path.join(BASE_DIR, "static")
MATERIALS_DIR = os.path.join(BASE_DIR, "materials")
EMBED_CACHE_PATH = os.path.join(BASE_DIR, "materials_index_cache.npy")

# Konfig Ollama
OLLAMA_PORTS = [11435, 11434]
MODEL_NAME = "deepseek-r1:8b" 
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "mxbai-embed-large")

# Konfig RAG
RAG_CHUNK_MAX_CHARS = 400
MAX_HISTORY_CHARS = 1200
ENABLE_CHUNK_COMPRESSION = False
ENABLE_CRAG_EVALUATOR = True
CRAG_NO_RAG_THRESHOLD = 0.30
CRAG_KEEP_THRESHOLD = 0.40
CRAG_TOP_K = 3

# ================================================================
# UTIL: DETEKSI KODE & LABEL KOGNITIF
# ================================================================
CODE_REGEX = re.compile(r"```[\s\S]*?```|(\bfor\b|\bwhile\b|\bif\b|\bdef\b|\bprint\b|\breturn\b|;|=)")

def is_code_like(text: str) -> bool:
    """Deteksi apakah teks mengandung pola kode/algoritma."""
    return bool(CODE_REGEX.search(text or ""))

def cognitive_label(code: str) -> str:
    """Mengembalikan label penuh untuk kode kognitif (par/tar)."""
    c = (code or "").lower()
    if c == "par":
        return "PAR — Practical-Analytical"
    if c == "tar":
        return "TAR — Theoretical-Analytical"
    return "Default Cognitive"

def cq_label(code: str) -> str:
    """Mengembalikan label penuh untuk kode CQ (p/t/a)."""
    c = (code or "").lower()
    if c == "p":
        return "Praktis / Project"
    if c == "t":
        return "Teoretis / Thinking"
    if c == "a":
        return "Analitis / Abstract"
    return "Tanpa preferensi khusus"

def opposite_cognitive(code: str) -> str:
    """Mengembalikan kode kognitif yang berlawanan."""
    c = (code or "").lower()
    if c == "par":
        return "tar"
    if c == "tar":
        return "par"
    return "par"

def balanced_cq_compare(cq1: str, cq2: str) -> Tuple[str, str]:
    """Memilih kombinasi CQ perbandingan untuk mempromosikan eksplorasi."""
    all_cq = ["p", "t", "a"]
    used = {(cq1 or "").lower(), (cq2 or "").lower()}
    remaining = [c for c in all_cq if c not in used]
    if not remaining:
        return (cq1 or "t"), (cq2 or "a")
    cq_comp1 = remaining[0]
    cq_comp2 = cq1 or remaining[0]
    return cq_comp1, cq_comp2

# ================================================================
# PROMPT EXAMPLES (FEW-SHOT, COT, ZERO-SHOT) <--- PERUBAHAN NAMA VARIABEL
# ================================================================
PROMPT_EXAMPLES = """

=== CONTOH ZERO-SHOT (Gaya Langsung/Ringkas) ===
Pertanyaan: Apa perbedaan mendasar antara Array dan Linked List?
Jawaban yang diinginkan: 
Perbedaan mendasar antara Array dan Linked List terletak pada **alokasi memori** dan **struktur koneksi**.
* **Array**: Alokasi memori kontigu (berdekatan). Akses elemen cepat (O(1)) berdasarkan indeks. Ukuran seringkali statis.
* **Linked List**: Alokasi memori tersebar (dinamis), dihubungkan oleh pointer. Akses elemen lambat (O(n)) sekuensial. Modifikasi elemen (insert/delete) cepat (O(1)).
=== AKHIR CONTOH ZERO-SHOT ===


=== CONTOH COT (Chain-of-Thought/Langkah Berpikir) ===
Pertanyaan: Apa perbedaan mendasar antara Array dan Linked List?
Jawaban yang diinginkan: 
Mari kita pikirkan ini langkah demi langkah.
1. **Identifikasi Kebutuhan Memori:** Pertimbangkan bagaimana Array dan Linked List dialokasikan. Array memerlukan blok memori berurutan (kontigu), sementara Linked List menggunakan memori tersebar yang dihubungkan oleh pointer.
2. **Analisis Kompleksitas Waktu:** Berpikir secara algoritmik: Bagaimana kompleksitas waktu mempengaruhi pencarian (akses O(1) vs O(n)) dan modifikasi (insert/delete O(n) vs O(1))?
3. **Kembangkan Jawaban Akhir:** Gunakan poin-poin analisis di atas untuk merumuskan jawaban yang akurat dan terperinci.
Jawaban Akhir: 
Perbedaan mendasar antara Array dan Linked List terletak pada **alokasi memori** dan **struktur koneksi**. (lanjutan penjelasan).
=== AKHIR CONTOH COT ===


=== CONTOH FEW-SHOT (Gaya TAR/Teoretis) ===
Pertanyaan: Apa perbedaan mendasar antara Array dan Linked List?
Jawaban yang diinginkan: 
Mari kita pikirkan ini langkah demi langkah.
1. **Analisis Struktur Data:** Array menyimpan data di blok memori yang berdekatan (kontigu), memungkinkan akses O(1) dengan indeks, tetapi penyisipan/penghapusan mahal (O(n)). Linked List menyimpan node yang menunjuk ke node berikutnya (akses sekuensial), sehingga akses O(n) dan penyisipan/penghapusan O(1).
2. **Kembangkan Jawaban (Teoretis/Definisi):** Perbedaan mendasar terletak pada alokasi memori dan cara elemen dihubungkan. Array menggunakan memori statis/terstruktur, sementara Linked List menggunakan memori dinamis dan pointer.
Jawaban Akhir: 
Perbedaan mendasar antara Array dan Linked List terletak pada **alokasi memori** dan **struktur koneksi**.
* **Array**: Alokasi memori kontigu (berdekatan). Akses elemen cepat (O(1)) berdasarkan indeks. Ukuran seringkali statis.
* **Linked List**: Alokasi memori tersebar (dinamis), dihubungkan oleh pointer. Akses elemen lambat (O(n)) sekuensial. Modifikasi elemen (insert/delete) cepat (O(1)).
=== AKHIR CONTOH FEW-SHOT ===
"""
