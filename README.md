# 🎓 LLM — Personalized Learning System

Asisten belajar interaktif berbasis **FastAPI** + **Ollama LLM**.  
Sistem ini menyesuaikan jawaban dengan **gaya belajar** (Visual, Auditori, Kinestetik), serta menyimpan **riwayat percakapan** yang bisa diunduh.

---

✨ Features
- Jawaban adaptif sesuai tipe kognitif
- Mode perbandingan acak antar gaya belajar
- Evaluasi jawaban (Benar/Salah dengan feedback)
- Riwayat percakapan dapat diunduh (TXT / JSON)
- Frontend sederhana dengan HTML, CSS, JS

---

🛠 Tech Stack
- Backend LLM: FastAPI, Uvicorn
- Backend Auth: PHP, MySQL (melalui XAMPP)
- LLM: Ollama (gpt-oss, mxbai-embed-large)
- Frontend: HTML, CSS, JavaScript

---

## 📂 Project Structure
```markdown
📁 csipbllm-personalizedlearningsystem
├── backend-py/
│    ├── ollamaapi.py # Backend FastAPI (LLM, Chat, RAG)
│    ├── static/ # Frontend (index.html, script.js, style.css)
├── backend-php/
│    ├── config.php # Konfigurasi DB
│    ├── login.php
│    ├── register.php # ... dan file user management lainnya
├── requirements.txt
└── README.md
```

Sistem ini menggunakan arsitektur dual-backend:
1. PHP (Port 8001): Mengelola Autentikasi User dan Manajemen Sesi/Riwayat Percakapan (Database).
2. Python/FastAPI (Port 8000): Menjalankan Model LLM, RAG, dan Logika Adaptif Chatbot.

---

## 1. PRASYARAT
Pastikan Anda telah menginstal:
- Ollama: Untuk menjalankan Local LLM (deepseek-r1:8b dan mxbai-embed-large).
- XAMPP/MAMP/WAMP: Untuk menjalankan server PHP dan MySQL/MariaDB.
- Python 3.10+ dengan pip.

---

## 2. PENGGUNAAN DATABASE (MENGGUNAKAN XAMPP)

LANGKAH 2.1: Mulai MySQL
1. Jika menggunakan XAMPP, buka XAMPP Control Panel dan mulai modul **MySQL**.
2. Jika menggunakan instalasi standalone, pastikan layanan MySQL/MariaDB sudah aktif.

LANGKAH 2.2: Buat Database dan Tabel Via MySQL Shell
1. Buka terminal/Command Prompt dan arahkan ke direktori bin MySQL/XAMPP agar perintah 'mysql' dapat dieksekusi.
2. Masuk ke MySQL shell (ganti 'root' dan kosongkan/ganti '-p' jika Anda menggunakan password).

```bash
# Contoh masuk sebagai user 'root' tanpa password
mysql -u root

# Contoh masuk dengan user dan password
# mysql -u your_db_user -p 
# (Masukkan password ketika diminta)
```
3. Setelah masuk ke prompt MySQL (prompt: mysql> ), jalankan perintah SQL berikut:
```sql
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(100) NULL,
    password VARCHAR(255) NOT NULL,
    cognitive VARCHAR(50) DEFAULT 'par',
    cq1 VARCHAR(10) DEFAULT 't',
    cq2 VARCHAR(10) DEFAULT 'a',
    created_at DATETIME NOT NULL
);
```

```sql
CREATE TABLE chat_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    cognitive_start VARCHAR(50) NOT NULL,
    cq1_start VARCHAR(10) NOT NULL,
    cq2_start VARCHAR(10) NOT NULL,
    start_time DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

```sql
CREATE TABLE conversation_turns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    turn_type VARCHAR(20) NOT NULL,
    user_message MEDIUMTEXT NOT NULL,
    reply_main MEDIUMTEXT NOT NULL,
    reply_compare MEDIUMTEXT NULL,
    followup_question TEXT NULL,
    cognitive_main VARCHAR(50) NULL,
    cq1_main VARCHAR(10) NULL,
    cq2_main VARCHAR(10) NULL,
    prompt_style_main VARCHAR(50) NULL,
    is_correct TINYINT(1) DEFAULT 0,
    wrong_attempts INT DEFAULT 0,
    latency_main_s FLOAT DEFAULT 0.0,
    used_rag TINYINT(1) DEFAULT 0,
    rag_mode VARCHAR(50) NULL,
    log_time DATETIME NOT NULL,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
```

---

## 3. PENYIAPAN BACKEND PHP (OTENTIKASI & LOG)

LANGKAH 3.1: Konfigurasi DB dan Keamanan (File: backend-php/config.php)
Ubah kredensial DB dan AUTH_SECRET Anda.

```php
// ====== KEAMANAN KRITIS: GANTI INI! ======
define("AUTH_SECRET", getenv('AUTH_SECRET') ?: "secret_key_yang_sangat_panjang_dan_rumit_ganti_ini"); // <-- UBAH INI
```

``db
$DB_HOST = getenv('DB_HOST') ?: "localhost";
$DB_USER = getenv('DB_USER') ?: "your_db_username"; // <-- UBAH INI
$DB_PASS = getenv('DB_PASS') ?: "your_db_password"; // <-- UBAH INI
$DB_NAME = getenv('DB_NAME') ?: "llmchatbot";
``

LANGKAH 3.2: Jalankan Server PHP
Arahkan terminal ke folder backend-php.

```bash
php -S 127.0.0.1:8001
```

*Server PHP kini berjalan di http://127.0.0.1:8001.*

---

## 4. PENYIAPAN BACKEND PYTHON (LLM, RAG, & FASTAPI)

LANGKAH 4.1: Buat dan Aktifkan Virtual Environment (.venv)
Arahkan terminal ke folder utama proyek Anda.

```bash
# Membuat Virtual Environment
python3 -m venv .venv

# Mengaktifkan Virtual Environment (Linux/macOS)
source .venv/bin/activate

# Mengaktifkan Virtual Environment (Windows CMD/PowerShell)
# .venv\Scripts\activate
```

LANGKAH 4.2: Instal Dependensi
Setelah .venv aktif, instal semua pustaka dari requirements.txt.

```bash
pip install -r requirements.txt
```

LANGKAH 4.3: Unduh Model Ollama
Pastikan Ollama sedang berjalan (`ollama serve`) di latar belakang.

```bash
ollama pull deepseek-r1:8b
ollama pull mxbai-embed-large
```

LANGKAH 4.4: Jalankan Server FastAPI menggunakan Uvicorn
Arahkan terminal ke folder `backend-py`. Jalankan aplikasi `ollamaapi:app` menggunakan `uvicorn` di port 8000. Fitur `reload=True` akan membantu saat pengembangan.

```bash
# Pastikan terminal berada di folder backend-py
uvicorn ollamaapi:app --host 127.0.0.1 --port 8000 --reload
```
*Server Python/FastAPI kini berjalan di http://127.0.0.1:8000.*

---

## 5. PENGGUNAAN APLIKASI
Pastikan semua komponen berjalan secara bersamaan:
1. MySQL/MariaDB (via XAMPP/Standalone).
2. PHP API Server (Port 8001).
3. Ollama Server (Port 11434/11435).
4. Python/FastAPI Server (Port 8000).

Akses Frontend di http://127.0.0.1:8000.
