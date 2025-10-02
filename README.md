# 🎓 LLM — Personalized Learning System

Asisten belajar interaktif berbasis **FastAPI** + **Ollama LLM**.  
Sistem ini menyesuaikan jawaban dengan **gaya belajar** (Visual, Auditori, Kinestetik), serta menyimpan **riwayat percakapan** yang bisa diunduh.

---

## ✨ Features
- ✅ Jawaban adaptif sesuai tipe kognitif  
- 🔄 Mode perbandingan acak antar gaya belajar  
- 📝 Evaluasi jawaban (Benar/Salah dengan feedback)  
- 💾 Riwayat percakapan dapat diunduh (TXT / JSON)  
- 🌐 Frontend sederhana dengan HTML, CSS, JS  

---

## 🛠 Tech Stack
- **Backend**: FastAPI, Uvicorn  
- **LLM**: Ollama (`gpt-oss`)  
- **Frontend**: HTML, CSS, JavaScript  

---

## 📂 Project Structure
📁 csipbllm-personalizedlearningsystem
├── ollamaapi.py # Backend FastAPI
├── static/
│    ├── index.html # UI
│    ├── script.js # Frontend logic
│    └── style.css # Styling
└── README.md

## 1. **Clone repository**
```bash
git clone https://github.com/vzhakir/csipbllm-personalizedlearningsystem.git
cd csipbllm-personalizedlearningsystem
   ```

## 2. **Buat virtual environment**
```bash
  python -m venv .venv
  ```

Aktifkan sesuai OS:
## Windows (Powershell)
```bash
  .venv\Scripts\Activate.ps1
  ```

## Linux/Mac
```bash
  source .venv/bin/activate
  ```

## 3. Install dependencies
```bash
  pip install -r requirements.txt
  ```

## 4. Jalankan server
```bash
uvicorn ollamaapi:app --reload
```

Buka di browser: http://127.0.0.1:8000
