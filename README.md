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

## 1. **Persiapan Awal**
A. Clone Repository
```bash
git clone https://github.com/vzhakir/csipbllm-personalizedlearningsystem.git
cd csipbllm-personalizedlearningsystem
   ```
B. Install Ollama (Wajib)
Pastikan Anda sudah menginstal Ollama dan menjalankan model yang dibutuhkan (misalnya deepseek-r1:8b dan mxbai-embed-large) agar backend FastAPI dapat berfungsi.

## 2. **Setup Database (XAMPP / MySQL)**
Sistem menggunakan database MySQL untuk menyimpan data pengguna (login/register). XAMPP adalah cara termudah untuk menjalankan server web lokal (Apache) dan database (MySQL/MariaDB).
A. Aktifkan XAMPP
Jalankan aplikasi XAMPP Control Panel.
Start modul Apache dan MySQL/MariaDB.

B. Buat Database
Akses phpMyAdmin (biasanya melalui http://localhost/phpmyadmin).
Buat database baru dengan nama: llmchatbot.

C. Buat Tabel users
Jalankan skema SQL berikut di database llmchatbot. Tabel ini diperlukan untuk menyimpan data pengguna:
```sql
  CREATE TABLE users (
    id INT(11) AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(100),
    password VARCHAR(255) NOT NULL,
    cognitive VARCHAR(10) DEFAULT 'par',
    cq1 VARCHAR(10) DEFAULT 't',
    cq2 VARCHAR(10) DEFAULT 'a',
    created_at DATETIME
);
  ```
D. Konfigurasi PHP Backend
Buka file: backend-php/config.php.
Ubah variabel koneksi DB sesuai dengan pengaturan XAMPP Anda. Jika Anda menggunakan pengaturan default XAMPP (Username: root, Password: kosong), ubah menjadi:
```sql
   // ====== KONFIG DB ======
   $DB_HOST = "localhost";
   $DB_USER = "root";       // <-- Ubah sesuai setting Anda
   $DB_PASS = "";           // <-- Ubah sesuai setting Anda
   $DB_NAME = "llmchatbot"; // <-- Pastikan ini sesuai
  ```
Penting: Perhatikan script.js mengatur PHP_API_BASE ke http://127.0.0.1:8001. Anda harus memastikan folder backend-php dapat diakses oleh server Apache XAMPP pada URL/Port tersebut.
Opsi 1 (Direktori Web): Pindahkan seluruh konten backend-php/ ke dalam sub-direktori htdocs/ XAMPP, dan atur ulang port Apache XAMPP ke 8001, ATAU
Opsi 2 (Ubah Port Frontend): Biarkan Apache di port default 80 (jika tidak bentrok), lalu ubah const PHP_API_BASE di backend-py/static/script.js ke http://127.0.0.1/nama_folder_anda jika Anda menempatkan folder PHP di htdocs.

## 3. **Setup Python Backend (FastAPI)**
A. Buat Virtual Environment
```bash
  python -m venv .venv
  ```
Aktifkan virtual environment sesuai OS Anda:
Windows (Powershell): .venv\Scripts\Activate.ps1
Linux/Mac: source .venv/bin/activate

## 4. **Deployment: Jalankan Kedua Server**
Anda harus menjalankan kedua backend secara bersamaan agar sistem berfungsi penuh.

A. Jalankan PHP Backend (via XAMPP)
Pastikan modul Apache dan MySQL di XAMPP sudah berjalan.
Pastikan file PHP Anda dapat diakses di URL yang sesuai (misalnya: http://127.0.0.1:8001/login.php atau sesuai konfigurasi Anda).
B. Jalankan Python/FastAPI Backend
Dari direktori utama proyek, jalankan server LLM:
```bash
  cd backend-py
uvicorn ollamaapi:app --reload
  ```

Server akan berjalan di: http://127.0.0.1:8000.
Setelah kedua server berjalan, Anda dapat mengakses aplikasi di browser Anda: http://127.0.0.1:8000.
