import requests
import json
import time
from typing import Tuple, Optional, Any
from http import HTTPStatus
from .config import MODEL_NAME, OLLAMA_PORTS # <-- Impor Relatif

# Import optional LangChain components
try:
    from langchain_ollama import ChatOllama
except ImportError:
    ChatOllama = None          # type: ignore

# ================================================================
# KONFIG & INISIALISASI OLLAMA
# ================================================================

OLLAMA_API_URL: Optional[str] = None
base_ollama_url: Optional[str] = None

# Mencari port Ollama yang aktif
for port in OLLAMA_PORTS:
    try:
        r = requests.get(f"http://localhost:{port}/api/tags", timeout=2)
        if r.status_code in (HTTPStatus.OK.value, HTTPStatus.NOT_FOUND.value): 
            OLLAMA_API_URL = f"http://localhost:{port}/api/generate"
            base_ollama_url = f"http://localhost:{port}"
            print(f"[SYSTEM] ✅ Ollama terdeteksi di port {port}")
            break
    except Exception:
        continue

if not OLLAMA_API_URL:
    base_ollama_url = "http://localhost:11434"
    OLLAMA_API_URL = base_ollama_url + "/api/generate"
    print("[SYSTEM] ⚠️ Tidak menemukan Ollama di port 11435/11434, asumsi 11434.")

# LangChain LLM (opsional)
llm: Any = None
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


# ================================================================
# OLLAMA WRAPPERS (HTTP & LangChain)
# ================================================================
def _query_ollama_http(prompt: str, retries: int = 3, delay: int = 5) -> str:
    """Mengirim prompt menggunakan HTTP POST mentah ke Ollama API."""
    if not OLLAMA_API_URL:
        return "[Error Ollama] URL API tidak dikonfigurasi."
        
    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "stream": False,
    }
    for attempt in range(retries):
        try:
            r = requests.post(OLLAMA_API_URL, json=payload, timeout=1500)
            if r.status_code == HTTPStatus.OK.value:
                try:
                    data = r.json()
                    return (data.get("response") or "").strip() or "[Error] Model tidak mengembalikan jawaban."
                except json.JSONDecodeError:
                    return "[Error] Respons JSON tidak valid."
            elif r.status_code == HTTPStatus.INTERNAL_SERVER_ERROR.value:
                print("[OllamaHTTP] ⚠️ Model belum siap, retry...")
                time.sleep(delay)
                continue
            else:
                return f"[Error Ollama API] HTTP {r.status_code}: {r.text[:200]}"
        except requests.exceptions.RequestException as e:
            print(f"[OllamaHTTP] ❌ Exception ({e.__class__.__name__}), retry...")
            time.sleep(delay)
    return "[Error Ollama API] Gagal menghubungi Ollama setelah beberapa percobaan."


def query_ollama(prompt: str, retries: int = 3, delay: int = 5) -> Tuple[str, float]:
    """
    Mengirim prompt ke LLM, mengukur latency, dan menggunakan fallback.
    """
    start_time = time.time()
    text = ""
    
    if llm is not None:
        # Logika LangChain
        for attempt in range(retries):
            try:
                result = llm.invoke(prompt)
                text = getattr(result, "content", None) or str(result)
                text = (text or "").strip()
                latency = time.time() - start_time
                return text, latency
            except Exception as e:
                print(f"[OllamaLC] ❌ Exception: {e}")
                time.sleep(delay)

        print("[OllamaLC] ⚠️ Gagal lewat LangChain, fallback HTTP.")

    # Fallback ke HTTP
    text = _query_ollama_http(prompt, retries=1, delay=delay)
    latency = time.time() - start_time 
    return text, latency


def get_ollama_status():
    """Checks if Ollama LLM is responsive using /api/tags."""
    if base_ollama_url and MODEL_NAME:
        try:
            list_url = base_ollama_url + "/api/tags"
            r = requests.get(list_url, timeout=5)
            
            if r.status_code == HTTPStatus.OK.value:
                data = r.json()
                models = [m.get('name') for m in data.get('models', []) if m.get('name')]
                if MODEL_NAME in models:
                    return {"status": "ok", "message": "Ollama is ready.", "model_ready": True}
                return {"status": "warning", "message": f"Ollama running but model '{MODEL_NAME}' not loaded.", "model_ready": False}
            
            return {"status": "error", "message": f"Ollama HTTP error: {r.status_code}"}
        except requests.exceptions.RequestException as e:
            return {"status": "error", "message": f"Ollama connection failed: {e.__class__.__name__}"}
    
    return {"status": "error", "message": "Ollama URL or Model Name not configured."}