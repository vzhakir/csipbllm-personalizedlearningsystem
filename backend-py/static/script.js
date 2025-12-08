// script.js – Logika Frontend Lengkap (Chatbot, Login, Register, Modal, Delete Session, Adaptive Profile, Mermaid, Rename Session)

const PHP_API_BASE = "http://127.0.0.1:8001"; 

// =========================================================
// STATE & VARIBEL GLOBAL BARU UNTUK SESI PERMANEN
// =========================================================
let currentStage = 'chat'; // 'chat' atau 'evaluate'
let correctAnswer = "";
let wrongAttempts = 0;

// Variabel baru untuk manajemen sesi persisten
const currentUserId = localStorage.getItem("user_id") || "0";
let currentSessionId = localStorage.getItem("lastSessionId") || "default";


// =========================================================
// HELPER UMUM & MARKDOWN + MERMAID
// =========================================================
const $ = (sel) => document.querySelector(sel);
const getTrim = (el) => (el ? el.value.trim() : "");

const escapeHtml = (t) =>
  String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

let markedLib = null;
let mermaidLib = null; 

const loadMarked = () =>
  new Promise((resolve, reject) => {
    if (window.marked) return resolve(window.marked);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/marked@12.0.1/marked.min.js";
    s.onload = () => resolve(window.marked);
    s.onerror = () => reject(new Error("Gagal memuat library markdown"));
    document.head.appendChild(s);
  });

// Load Mermaid (NEW)
const loadMermaid = () =>
  new Promise((resolve, reject) => {
    if (window.mermaid) return resolve(window.mermaid);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"; 
    s.onload = () => {
        // Inisialisasi, tapi nonaktifkan auto-run agar kita bisa kontrol rendering per bubble
        window.mermaid.initialize({ 
            startOnLoad: false, 
            theme: 'dark', 
            securityLevel: 'loose' 
        }); 
        resolve(window.mermaid);
    };
    s.onerror = () => reject(new Error("Gagal memuat library Mermaid"));
    document.head.appendChild(s);
  });

const renderMarkdown = (text) => {
  if (!markedLib) return escapeHtml(text || "");
  try {
    return markedLib.parse(text || "");
  } catch {
    return escapeHtml(text || "");
  }
};


// =========================================================
// CHATBOT CORE STATE & UI CONTROL
// =========================================================

const appendBubble = (role, html) => {
  const chatBox = $("#chatBox");
  if (!chatBox) return null;
  const placeholder = chatBox.querySelector(".placeholder");
  if (placeholder) placeholder.remove();

  let className = 'chat-bubble';
  if (role === 'user') className += ' user';
  else if (role === 'bot') className += ' bot';
  else if (role === 'compare') className += ' compare';
  else if (role === 'status') className += ' status';
  
  const div = document.createElement("div");
  div.className = className;
  div.innerHTML = html;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  return div;
};

const setInputState = (stage, placeholderText = "") => {
    currentStage = stage;
    const mainInput = $("#mainInput");
    const stageText = $("#currentStageText");
    const sendBtn = $("#sendBtn");
    
    if (mainInput) {
        mainInput.placeholder = placeholderText;
        mainInput.value = ""; 
        mainInput.rows = 1; 
        mainInput.style.height = 'auto'; 
        if (sendBtn) sendBtn.disabled = false;
    }
    
    if (stageText) {
        if (stage === 'chat') {
            stageText.innerHTML = 'Mode: <span style="color:var(--brand)">Pertanyaan Baru</span>';
        } else if (stage === 'evaluate') {
            stageText.innerHTML = `Mode: <span style="color:var(--accent-red)">Evaluasi Jawaban (Percobaan ke-${wrongAttempts + 1})</span>`;
        }
    }
};

const setBusy = (busy) => {
    const sendBtn = $("#sendBtn");
    const mainInput = $("#mainInput");
    if (sendBtn) sendBtn.disabled = busy;
    if (mainInput) mainInput.disabled = busy;
    
    const stageText = $("#currentStageText");
    if (stageText) {
        if (busy) {
            stageText.textContent = "⏳ Memproses di Ollama...";
        } else {
            setInputState(currentStage, mainInput ? mainInput.placeholder : "");
        }
    }
};


// =========================================================
// LOGIKA UTAMA: CHAT & EVALUATE (DENGAN RENDERING MERMAID)
// =========================================================

/**
 * Fungsi untuk mencari dan merender blok 'mermaid' di dalam sebuah elemen.
 */
const renderMermaidInBubble = (bubbleElement) => {
    if (!mermaidLib) return;
    
    // Mermaid akan mencari tag <pre><code class="language-mermaid">
    const mermaidBlocks = bubbleElement.querySelectorAll('pre code[class*="language-mermaid"]');
    
    if (mermaidBlocks.length > 0) {
        // Jalankan Mermaid hanya pada elemen ini
        mermaidLib.run({ nodes: [bubbleElement] });
    }
};

const sendQuestion = async (message) => {
    if (!message) { alert("Tulis pertanyaan dulu."); return; }
    if (currentSessionId === "default") { 
        alert("Sesi belum dimulai. Mohon klik New Chat."); 
        return; 
    }

    const mode = $("#mode") ? $("#mode").value : "accurate";
    const prompt_style = $("#promptStyle") ? $("#promptStyle").value : "zero_shot";
    const cognitive = localStorage.getItem("cognitive") || "par";
    const cq1 = localStorage.getItem("cq1") || "t";
    const cq2 = localStorage.getItem("cq2") || "a";

    appendBubble("user", `<b>Kamu:</b> ${escapeHtml(message)}`);
    const loading = appendBubble("status", "<b>Bot:</b> ⏳ Menyusun jawaban...");

    wrongAttempts = 0;
    correctAnswer = "";
    
    setBusy(true);

    try {
        const res = await fetch("/chat", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                question: message, cognitive, cq1, cq2, mode, prompt_style, 
                session_id: currentSessionId // Kirim ID Sesi
            }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        if (loading) loading.remove();

        // Jawaban Utama
        const mainHeader = `Tutor (${data.cognitive_main} | Latensi: ${data.latency_main_s.toFixed(2)}s | Style: ${data.prompt_style_main.toUpperCase()})`;
        const mainReplyText = data.reply_main || "❌ Model gagal memberikan jawaban."; 
        const ragMeta = data.used_rag ? `<div class="rag-meta">🔎 RAG: ${data.rag_mode} (Materi tambahan digunakan).</div>` : `<div class="rag-meta">🤖 Jawaban utama tanpa RAG tambahan.</div>`;

        const mainHtml = `<b>${escapeHtml(mainHeader)}:</b><br/>${ragMeta}${renderMarkdown(mainReplyText)}`;
        const mainBubble = appendBubble("bot", mainHtml); // Tangkap elemen bubble

        // RENDER MERMAID
        renderMermaidInBubble(mainBubble);

        // Jawaban Perbandingan
        if (data.reply_compare) {
            const compareHeader = `Sudut Pandang Lain (${data.cognitive_compare} | CQ1:${data.cq1_compare}/CQ2:${data.cq2_compare})`;
            const compareHtml = `<b>${escapeHtml(compareHeader)}:</b><br/>${renderMarkdown(data.reply_compare)}`;
            const compareBubble = appendBubble("compare", compareHtml);
            renderMermaidInBubble(compareBubble);
        }

        correctAnswer = data.reply_main || ""; 
        const followupQuestion = data.followup_question || "Mohon coba rumuskan jawaban Anda sekarang.";

        // Tindak Lanjut / Rumusan Jawaban
        const followupHtml = `<div style="font-weight: 600; margin-bottom: 5px;">Tindak Lanjut:</div>${renderMarkdown(followupQuestion)}`;
        appendBubble("bot", followupHtml);
        
        // Alihkan ke mode Evaluasi (FITUR EVALUASI AKTIF)
        setInputState('evaluate', "Tulis jawabanmu untuk dievaluasi...");

    } catch (e) {
        if (loading) loading.remove();
        appendBubble("bot", `<b>Bot:</b> ❌ Terjadi error: ${escapeHtml(String(e))}`);
        setInputState('chat', "Tulis pertanyaan atau topik baru...");
    } finally {
        setBusy(false);
    }
};

const evaluateAnswer = async (userText) => {
    if (!userText) { alert("Tulis jawaban dulu."); return; }
    if (!correctAnswer) { alert("Internal Error: Kunci jawaban tidak ditemukan. Kirim pertanyaan dulu."); setInputState('chat', "Tulis pertanyaan atau topik baru..."); return; }
    if (currentSessionId === "default") { 
        alert("Internal Error: Sesi tidak teridentifikasi."); 
        return; 
    }

    appendBubble("user", `<b>[JAWABAN] Kamu:</b> ${escapeHtml(userText)}`);
    const loading = appendBubble("status", "<b>Bot:</b> ⏳ Menilai jawaban kamu...");

    // Ambil data profil saat ini untuk dikirim ke backend (untuk adaptasi)
    const cognitive = localStorage.getItem("cognitive") || "par";
    const cq1 = localStorage.getItem("cq1") || "t";
    const cq2 = localStorage.getItem("cq2") || "a";
    
    setBusy(true);

    try {
        const res = await fetch("/evaluate", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                user_answer: userText, 
                correct_answer: correctAnswer, 
                wrong_count: wrongAttempts,
                session_id: currentSessionId, // Kirim ID Sesi
                current_cognitive: cognitive, // Kirim profil saat ini
                current_cq1: cq1,
                current_cq2: cq2
            }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        if (loading) loading.remove();
        
        wrongAttempts = data.is_correct ? 0 : wrongAttempts + 1;

        const status = data.is_correct ? "✅ Jawabanmu sudah tepat!" : "❌ Jawabanmu masih perlu diperbaiki.";
        const detail = data.feedback || "";

        // Tampilkan Hasil Evaluasi (FITUR EVALUASI IN-LINE)
        const evalHtml = `
            <div class="eval-result ${data.is_correct ? 'correct' : 'incorrect'}">${status}</div>
            <div style="margin-top:4px;">${renderMarkdown(detail)}</div>
            <div class="rag-meta" style="border-top: none;">Stage: ${data.hint_level || 'Tindak Lanjut'}</div>
        `;
        const feedbackBubble = appendBubble("bot", `<b>Tutor (Feedback):</b><br/>${evalHtml}`);
        renderMermaidInBubble(feedbackBubble); // RENDER MERMAID (jika ada)

        if (data.is_correct) {
            const followupHtml = `<div style="font-weight: 600; margin-bottom: 5px;">Tindak Lanjut:</div>${renderMarkdown(data.followup_question)}`;
            appendBubble("bot", followupHtml);
            
            setInputState('chat', "🎉 Anda sudah menguasai materi! Tulis pertanyaan atau topik baru...");
            correctAnswer = ""; 
            
        } else {
            const followupHtml = `<div style="font-weight: 600; margin-bottom: 5px;">Petunjuk Baru:</div>${renderMarkdown(data.followup_question)}`;
            appendBubble("bot", followupHtml);
            
            setInputState('evaluate', "Tulis perbaikan jawabanmu berdasarkan petunjuk di atas...");
        }
        
        // --- LOGIKA ADAPTASI DINAMIS ---
        const suggestion = data.profile_suggestion;
        if (suggestion && suggestion.suggest_change) {
            const newCog = suggestion.new_cognitive;
            const newCq1 = suggestion.new_cq1;
            const newCq2 = suggestion.new_cq2;
            const currentCog = localStorage.getItem("cognitive");
            const currentCq1 = localStorage.getItem("cq1");

            // Cek apakah ada perubahan signifikan
            if (newCog !== currentCog || newCq1 !== currentCq1) {
                const confirmMsg = `
                    Adaptasi Disarankan!
                    Berdasarkan kesulitan Anda, Tutor menyarankan perubahan profil:
                    - Profil Baru: ${newCog.toUpperCase()} (CQ1: ${newCq1.toUpperCase()}, CQ2: ${newCq2.toUpperCase()})
                    
                    Alasan: ${suggestion.message}
                    
                    Apakah Anda ingin menerapkan profil baru ini sekarang?
                `;

                if (confirm(confirmMsg)) {
                    await applyProfileUpdate(newCog, newCq1, newCq2);
                }
            }
        }
        // --- AKHIR LOGIKA ADAPTASI DINAMIS ---


    } catch (e) {
        if (loading) loading.remove();
        appendBubble("bot", `<b>Bot:</b> ❌ Error menilai jawaban: ${escapeHtml(String(e))}`);
        setInputState('evaluate', "Tulis perbaikan jawabanmu berdasarkan petunjuk di atas...");
    } finally {
        setBusy(false);
    }
};

// --- Download History (MODIFIKASI: Ambil dari DB via PHP) ---
const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

const downloadHistoryTxt = async () => {
    if (currentSessionId === "default") return;
    try {
      const res = await fetch(PHP_API_BASE + "/get_chat_history.php", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: currentUserId, session_id: currentSessionId, format: "txt" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const txt = data.data || "Belum ada riwayat percakapan.";
      triggerDownload(new Blob([txt], { type: "text/plain" }), `history_session_${currentSessionId}.txt`);
    } catch (e) {
      appendBubble("bot", `❌ Gagal mengunduh riwayat TXT: ${escapeHtml(String(e))}`);
    }
};

const downloadHistoryJson = async () => {
    if (currentSessionId === "default") return;
    try {
      const res = await fetch(PHP_API_BASE + "/get_chat_history.php", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: currentUserId, session_id: currentSessionId, format: "json" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Data yang di-return adalah object { turns: [...] }
      triggerDownload(new Blob([JSON.stringify(data.turns || data, null, 2)], { type: "application/json" }), `history_session_${currentSessionId}.json`);
    } catch (e) {
      appendBubble("bot", `❌ Gagal mengunduh riwayat JSON: ${escapeHtml(String(e))}`);
    }
};


// =========================================================
// PHP API CLIENT (LOGIN, REGISTER, USER INFO & UPDATE)
// =========================================================

const COG_OPTIONS = { par: "PAR — Practical-Analytical", tar: "TAR — Theoretical-Analytical" };
const CQ_OPTIONS = { t: "T — Teoretis / Thinking", a: "A — Analitis / Abstract", p: "P — Praktis / Project" };

function createSelectHTML(id, optionsMap, currentValue) {
    let options = '';
    for (const [val, label] of Object.entries(optionsMap)) {
      const selected = val === currentValue ? 'selected' : '';
      options += `<option value="${val}" ${selected}>${label}</option>`;
    }
    return `<select id="${id}" class="user-modal-select">${options}</select>`;
}


// --- Register Logic (omitted for brevity) ---
function setupRegisterPage() {
  if (localStorage.getItem("username")) { window.location.href = "/"; return; }
  const regUsername = $("#regUsername");
  const regPassword = $("#regPassword");
  const regCognitive = $("#regCognitive");
  const regCq1 = $("#regCq1");
  const regCq2 = $("#regCq2");
  const registerError = $("#registerError");
  const btnRegister = $("#btnRegister");

  const setRegBusy = (b) => {
    if (!btnRegister) return;
    btnRegister.disabled = b;
    btnRegister.textContent = b ? "Memproses..." : "Daftar";
  };

  async function doRegister() {
    registerError.textContent = "";
    const username = regUsername.value.trim();
    const password = regPassword.value.trim();
    const email = $("#regEmail") ? $("#regEmail").value.trim() : ""; 
    const cognitive = regCognitive ? regCognitive.value.trim() : "";
    const cq1 = regCq1 ? regCq1.value.trim() : "";
    const cq2 = regCq2 ? regCq2.value.trim() : "";

    if (!username || !password) { registerError.textContent = "Username dan password wajib diisi."; return; }

    setRegBusy(true);
    try {
      const res = await fetch(PHP_API_BASE + "/register.php", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, email, cognitive, cq1, cq2 }),
      });
      const data = await res.json();
      if (data.status !== "success") { registerError.textContent = data.message || "Registrasi gagal."; return; }

      if (data.user_id) localStorage.setItem("user_id", data.user_id);
      if (data.username) localStorage.setItem("username", data.username);
      if (email) localStorage.setItem("email", email); 
      if (data.cognitive) localStorage.setItem("cognitive", data.cognitive);
      if (data.cq1) localStorage.setItem("cq1", data.cq1);
      if (data.cq2) localStorage.setItem("cq2", data.cq2);
      window.location.href = "/";
    } catch (err) {
      registerError.textContent = "Tidak bisa terhubung ke server registrasi.";
    } finally {
      setRegBusy(false);
    }
  }

  if (btnRegister) btnRegister.addEventListener("click", doRegister);
  if (regPassword) { regPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") doRegister(); }); }
}

// --- Login Logic (omitted for brevity) ---
function setupLoginPage() {
    if (localStorage.getItem("username")) { window.location.href = "/"; return; }
    const loginUsername = $("#loginUsername");
    const loginPassword = $("#loginPassword");
    const loginError = $("#loginError");
    const btnLogin = $("#btnLogin");

    const setLogBusy = (b) => {
        if (!btnLogin) return;
        btnLogin.disabled = b;
        btnLogin.textContent = b ? "Memproses..." : "Masuk";
    };

    async function doLogin() {
        loginError.textContent = "";
        const username = loginUsername.value.trim();
        const password = loginPassword.value.trim();

        if (!username || !password) { loginError.textContent = "Username dan password wajib diisi."; return; }

        setLogBusy(true);
        try {
            const res = await fetch(PHP_API_BASE + "/login.php", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json();
            if (data.status !== "success") { loginError.textContent = data.message || "Login gagal."; return; }

            if (data.user_id) localStorage.setItem("user_id", data.user_id);
            if (data.username) localStorage.setItem("username", data.username);
            if (data.email) localStorage.setItem("email", data.email); 
            if (data.cognitive) localStorage.setItem("cognitive", data.cognitive);
            if (data.cq1) localStorage.setItem("cq1", data.cq1);
            if (data.cq2) localStorage.setItem("cq2", data.cq2);

            window.location.href = "/";
        } catch (err) {
            loginError.textContent = "Tidak bisa terhubung ke server login.";
        } finally {
            setLogBusy(false);
        }
    }
    if (btnLogin) btnLogin.addEventListener("click", doLogin);
    if (loginPassword) { loginPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); }); }
}


/**
 * Mengirim permintaan update profil ke backend PHP
 */
async function applyProfileUpdate(cognitive, cq1, cq2) {
    const userId = currentUserId;
    const currentEmail = localStorage.getItem("email") || "";
    
    if (!userId || userId === "0") return;

    try {
        const res = await fetch(PHP_API_BASE + "/update_profile.php", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                user_id: Number(userId), 
                email: currentEmail, 
                cognitive: cognitive, 
                cq1: cq1, 
                cq2: cq2 
            }),
        });
        const data = await res.json();
        
        if (data.status === "success") {
            // Update Local Storage
            localStorage.setItem("cognitive", data.cognitive);
            localStorage.setItem("cq1", data.cq1);
            localStorage.setItem("cq2", data.cq2);
            
            // Perbarui tampilan ringkasan profil di chat box
            initProfileFromStorage(); 
            
            alert("✅ Profil kognitif berhasil diadaptasi!");
        } else {
             alert("❌ Gagal mengadaptasi profil: " + (data.message || "Unknown error"));
        }
    } catch (err) {
        alert("❌ Error koneksi ke update_profile.php saat adaptasi.");
    }
}


// --- User Info & Update Logic (Modal Logic) --- 
async function doUpdateProfile() {
    const userId = localStorage.getItem("user_id");
    const newCognitive = $("#udCognitiveSelect").value;
    const newCq1 = $("#udCq1Select").value;
    const newCq2 = $("#udCq2Select").value;
    const newEmail = getTrim($("#udEmailInput"));
    const btnSaveProfile = $("#btnSaveProfile");

    if (!userId) { alert("user_id tidak ditemukan. Gagal update."); return; }
    
    const isModalBusy = (b) => { 
        if(btnSaveProfile) btnSaveProfile.disabled = b;
        const debugEl = $("#udDebug");
        if(debugEl) debugEl.textContent = b ? "⏳ Memproses update profil..." : "";
    };
    isModalBusy(true);
    
    try {
        const res = await fetch(PHP_API_BASE + "/update_profile.php", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: Number(userId), email: newEmail, cognitive: newCognitive, cq1: newCq1, cq2: newCq2 }),
        });
        const data = await res.json();
        
        if (data.status === "success") {
            localStorage.setItem("cognitive", data.cognitive);
            localStorage.setItem("cq1", data.cq1);
            localStorage.setItem("cq2", data.cq2);
            localStorage.setItem("email", data.email);
            $("#udDebug").textContent = "✅ Profil berhasil diupdate!";
            loadUserInfoForModal(); 
            initProfileFromStorage(); 
        } else {
             $("#udDebug").textContent = "❌ Gagal update: " + (data.message || "Unknown error");
        }
    } catch (err) {
        $("#udDebug").textContent = "❌ Error koneksi ke update_profile.php";
    } finally {
        isModalBusy(false);
    }
}

async function loadUserInfoForModal() {
    const userId = localStorage.getItem("user_id");
    const username = localStorage.getItem("username") || "-";
    const udUsername = $("#udUsername");
    const udEmailContainer = $("#udEmailContainer"); 
    const udCognitiveContainer = $("#udCognitiveContainer");
    const udCq1Container = $("#udCq1Container");
    const udCq2Container = $("#udCq2Container");
    const udCreatedAt = $("#udCreatedAt");
    const udDebug = $("#udDebug");
    const userModalFooter = $(".user-modal-footer");

    if (udUsername) udUsername.textContent = username;
    if (udDebug) udDebug.textContent = "";

    let btnUpdate = document.getElementById("btnSaveProfile");
    if (btnUpdate) btnUpdate.remove();

    if (!userId) { return; }

    try {
      const res = await fetch(PHP_API_BASE + "/userinfo.php", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: Number(userId) }),
      });
      const data = await res.json();

      if (data.status === "success" && data.user) {
        const u = data.user;
        
        if (udEmailContainer) {
            udEmailContainer.innerHTML = `<span class="label">Email:</span>
                <input type="email" id="udEmailInput" class="user-modal-input" value="${escapeHtml(u.email || "")}" />`;
        }
        if (udCognitiveContainer) {
            udCognitiveContainer.innerHTML = `<span class="label">Tipe Kognitif:</span>
                ${createSelectHTML("udCognitiveSelect", COG_OPTIONS, u.cognitive || "par")}`;
        }
        if (udCq1Container) {
            udCq1Container.innerHTML = `<span class="label">CQ1:</span>
                ${createSelectHTML("udCq1Select", CQ_OPTIONS, u.cq1 || "t")}`;
        }
        if (udCq2Container) {
            udCq2Container.innerHTML = `<span class="label">CQ2:</span>
                ${createSelectHTML("udCq2Select", CQ_OPTIONS, u.cq2 || "a")}`;
        }

        if (udCreatedAt) udCreatedAt.textContent = u.created_at || "-";
        
        btnUpdate = document.createElement("button");
        btnUpdate.id = "btnSaveProfile";
        btnUpdate.className = "user-update-btn";
        btnUpdate.textContent = "Simpan Perubahan";
        btnUpdate.addEventListener("click", doUpdateProfile);

        const btnDeleteUser = $("#btnDeleteUser");
        if (userModalFooter) { userModalFooter.insertBefore(btnUpdate, btnDeleteUser); }
        
        const btnDeleteAllChats = $("#btnDeleteAllChats");
        if (userModalFooter && btnDeleteAllChats) { 
            userModalFooter.insertBefore(btnDeleteAllChats, btnDeleteUser);
        }


      } else if (udDebug) {
        udDebug.textContent = "Gagal mengambil data user dari server.";
      }
    } catch (err) {
      if (udDebug) udDebug.textContent = "Error koneksi ke userinfo.php";
    }
}

// --- Init Profile Summary ---
const initProfileFromStorage = () => {
    const storedCognitive = localStorage.getItem("cognitive") || "par";
    const storedCq1 = localStorage.getItem("cq1") || "t";
    const storedCq2 = localStorage.getItem("cq2") || "a";
    const cognitiveSelect = $("#cognitive");
    
    if (cognitiveSelect) cognitiveSelect.value = storedCognitive;
    if ($("#profileSummary")) {
        const cogLabel = storedCognitive === "tar" ? "TAR — Theoretical-Analytical" : "PAR — Practical-Analytical";
        const cqMap = { p: "P/Project", t: "T/Thinking", a: "A/Abstract" };

        $("#profileSummary").innerHTML = `
          Profil Anda: <b>${escapeHtml(cogLabel)}</b> | CQ1: <b>${escapeHtml(cqMap[storedCq1] || '-')}</b>, CQ2: <b>${escapeHtml(cqMap[storedCq2] || '-')}</b>
        `;
    }
};

// =========================================================
// HISTORY & SESSION MANAGEMENT
// =========================================================

/**
 * Mengganti nama sesi obrolan. (NEW)
 */
const renameChatSession = async (sessionId, currentTitle) => {
    if (currentUserId === "0") return;

    const newTitle = prompt("Masukkan nama baru untuk sesi ini:", currentTitle);
    
    if (!newTitle || newTitle.trim() === "" || newTitle.trim() === currentTitle.trim()) {
        if (newTitle !== null) alert("Nama sesi tidak diubah.");
        return;
    }

    try {
        const res = await fetch(PHP_API_BASE + "/rename_session.php", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: currentUserId, session_id: sessionId, new_title: newTitle.trim() }),
        });
        const data = await res.json();
        
        if (data.status === "success") {
            alert("Nama sesi berhasil diubah menjadi: " + data.new_title);
            loadHistorySidebar(); 
        } else {
            alert("Gagal mengganti nama sesi: " + (data.message || "Error tidak diketahui."));
        }
    } catch (e) {
        alert("Error koneksi saat mengganti nama sesi.");
        console.error("Error renaming session:", e);
    }
};


/**
 * Menghapus sesi obrolan dari DB.
 */
const deleteChatSession = async (sessionId) => {
    if (currentUserId === "0") return;

    if (!confirm(`Yakin ingin menghapus sesi ${sessionId} ini secara permanen? Aksi ini tidak dapat dibatalkan.`)) {
        return;
    }

    try {
        const res = await fetch(PHP_API_BASE + "/delete_session.php", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: currentUserId, session_id: sessionId }),
        });
        const data = await res.json();
        
        if (data.status === "success") {
            // Hapus sesi aktif: Mulai sesi baru (yang otomatis me-reload sidebar)
            if (sessionId == currentSessionId) {
                alert("Sesi aktif berhasil dihapus. Memulai sesi baru.");
                localStorage.removeItem("lastSessionId"); 
                startNewChat(false); 
            } else {
                // Hapus sesi TIDAK aktif: Hanya reload sidebar dan hapus visual
                alert("Sesi berhasil dihapus.");
                // Hapus elemen wrapper menggunakan ID sesi
                document.querySelector(`.history-item-wrapper[data-id="${sessionId}"]`)?.remove(); 

                loadHistorySidebar(); 
            }
        } else {
            alert("Gagal menghapus sesi: " + (data.message || "Error tidak diketahui."));
        }
    } catch (e) {
        alert("Error koneksi saat menghapus sesi.");
        console.error("Error deleting session:", e);
    }
};

/**
 * Menghapus SEMUA sesi obrolan dari DB.
 */
async function deleteAllChats() {
    if (currentUserId === "0") {
        alert("Autentikasi diperlukan."); 
        return;
    }

    const username = localStorage.getItem("username");

    if (!confirm(`PERINGATAN! Anda akan menghapus SEMUA riwayat chat Anda (${username}). Apakah Anda yakin?`)) {
        return;
    }
    
    // Konfirmasi kedua
    if (!confirm("Ini adalah aksi permanen dan tidak dapat dikembalikan. Lanjutkan menghapus SEMUA CHAT?")) {
        return;
    }

    const btn = document.getElementById("btnDeleteAllChats");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Menghapus...";

    try {
        const res = await fetch(PHP_API_BASE + "/delete_all_chats.php", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: currentUserId }),
        });
        const data = await res.json();

        if (data.status === "success") {
            alert(data.message);
            // Hapus session ID yang disimpan lokal karena sudah tidak valid
            localStorage.removeItem("lastSessionId"); 
            // Tutup modal
            document.getElementById("userDashboardOverlay").style.display = "none";
            // Mulai sesi baru (yang juga me-reload sidebar)
            startNewChat(false); 
        } else {
            alert("Gagal menghapus chat: " + (data.message || "Error server."));
        }
    } catch (e) {
        alert("Error koneksi saat mencoba menghapus semua chat.");
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}


/**
 * Memuat giliran percakapan dari sesi tertentu ke chat box.
 */
const loadSession = async (sessionId, title) => {
    const chatBox = $("#chatBox");
    if (!chatBox) return;

    // Hapus status aktif dari sesi sebelumnya (jika ada)
    document.querySelectorAll('.history-item.active').forEach(el => el.classList.remove('active'));
    
    // Set status aktif pada sesi yang dimuat
    document.querySelector(`.history-item[data-id="${sessionId}"]`)?.classList.add('active');


    currentSessionId = sessionId;
    localStorage.setItem("lastSessionId", sessionId);
    
    chatBox.innerHTML = `<div class="placeholder">⏳ Memuat sesi: ${escapeHtml(title)}...</div>`;
    correctAnswer = "";
    wrongAttempts = 0;
    setInputState('chat', "Tulis pertanyaan atau topik baru...");
    setBusy(true);

    try {
        const res = await fetch(PHP_API_BASE + "/get_chat_history.php", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: currentUserId, session_id: sessionId }),
        });
        const data = await res.json();
        
        if (chatBox) chatBox.innerHTML = '';
        if (data.status !== "success" || !data.turns) throw new Error("Gagal mengambil turns.");

        data.turns.forEach(turn => {
            const role = turn.turn_type === 'chat' ? 'bot' : 'status';
            
            if (turn.turn_type === 'chat') {
                // Tampilkan pesan user (pertanyaan)
                appendBubble("user", `<b>Kamu:</b> ${escapeHtml(turn.user_message)}`);
                
                // Tampilkan jawaban utama
                const ragMeta = turn.used_rag ? `<div class="rag-meta">🔎 RAG: ${turn.rag_mode} (Materi tambahan digunakan).</div>` : `<div class="rag-meta">🤖 Jawaban utama tanpa RAG tambahan.</div>`;
                const mainHeader = `Tutor (${turn.cognitive_main} | Latensi: ${Number(turn.latency_main_s).toFixed(2)}s | Style: ${turn.prompt_style_main.toUpperCase()})`;
                const mainHtml = `<b>${escapeHtml(mainHeader)}:</b><br/>${ragMeta}${renderMarkdown(turn.reply_main)}`;
                const mainBubble = appendBubble("bot", mainHtml);
                renderMermaidInBubble(mainBubble); // RENDER MERMAID
                

                // Tampilkan perbandingan
                if (turn.reply_compare) {
                    const compareHeader = `Sudut Pandang Lain (${turn.cognitive_compare} | CQ1:${turn.cq1_main}/CQ2:${turn.cq2_main})`;
                    const compareHtml = `<b>${escapeHtml(compareHeader)}:</b><br/>${renderMarkdown(turn.reply_compare)}`;
                    const compareBubble = appendBubble("compare", compareHtml);
                    renderMermaidInBubble(compareBubble); // RENDER MERMAID
                }

                // Simpan kunci jawaban dan alihkan ke mode evaluasi jika ini adalah turn terakhir
                correctAnswer = turn.reply_main || "";
                setInputState('evaluate', "Tulis jawabanmu untuk dievaluasi...");

            } else if (turn.turn_type === 'evaluate') {
                // Tampilkan jawaban user (evaluasi)
                appendBubble("user", `<b>[JAWABAN] Kamu:</b> ${escapeHtml(turn.user_message)}`);

                // Tampilkan feedback tutor
                const isCorrect = turn.is_correct === 1;
                const status = isCorrect ? "✅ Jawabanmu sudah tepat!" : "❌ Jawabanmu masih perlu diperbaiki.";
                const evalHtml = `
                    <div class="eval-result ${isCorrect ? 'correct' : 'incorrect'}">${status}</div>
                    <div style="margin-top:4px;">${renderMarkdown(turn.reply_main)}</div>
                    <div class="rag-meta" style="border-top: none;">Stage: ${turn.wrong_attempts} attempts</div>
                `;
                const feedbackBubble = appendBubble("bot", `<b>Tutor (Feedback):</b><br/>${evalHtml}`);
                renderMermaidInBubble(feedbackBubble); // RENDER MERMAID
                
                // Update state untuk turn terakhir
                if (!isCorrect) {
                     wrongAttempts = turn.wrong_attempts + 1;
                     setInputState('evaluate', "Tulis perbaikan jawabanmu berdasarkan petunjuk di atas...");
                } else {
                     wrongAttempts = 0;
                     correctAnswer = "";
                     setInputState('chat', "🎉 Anda sudah menguasai materi! Tulis pertanyaan atau topik baru...");
                }
            }
            
            // Tampilkan followup question/petunjuk baru (selalu di akhir)
            if (turn.followup_question) {
                const followupHtml = `<div style="font-weight: 600; margin-bottom: 5px;">Tindak Lanjut:</div>${renderMarkdown(turn.followup_question)}`;
                appendBubble("bot", followupHtml);
            }
        });

    } catch (e) {
        chatBox.innerHTML = `<div class="placeholder" style="color: var(--accent-red);">❌ Gagal memuat sesi: ${escapeHtml(String(e))}</div>`;
    } finally {
        setBusy(false);
    }
}


// --- History Sidebar Logic (MODIFIKASI: Menambahkan tombol delete dan rename) ---
const loadHistorySidebar = async () => {
    const historyList = $("#historyList");
    if (!historyList || currentUserId === "0") return;
    
    historyList.innerHTML = `<div class="loading-history">⏳ Memuat riwayat...</div>`;
    
    try {
        const res = await fetch(PHP_API_BASE + "/get_chat_history.php", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: currentUserId, session_id: 0 }), // session_id=0 untuk ambil daftar sesi
        });
        const data = await res.json();

        if (!res.ok || !data.sessions) throw new Error("Gagal fetch session list.");

        historyList.innerHTML = ''; 
        if (data.sessions.length === 0) {
            historyList.innerHTML = `<div style="padding:10px; font-size:13px;">Belum ada riwayat. Mulai obrolan baru!</div>`;
            return;
        }

        data.sessions.forEach((session, index) => {
            const fullTitle = session.title || "Untitled Chat";
            const shortTitle = fullTitle.substring(0, 30) + (fullTitle.length > 30 ? '...' : '');
            
            const item = document.createElement("div");
            item.className = 'history-item-wrapper';
            item.dataset.id = session.id; 
            
            // Elemen Title yang bisa di-klik untuk load
            const titleElement = document.createElement("div");
            titleElement.className = 'history-item';
            titleElement.textContent = shortTitle;
            titleElement.dataset.id = session.id; 

            if (session.id == currentSessionId) {
                titleElement.classList.add('active');
            }

            titleElement.addEventListener('click', () => {
                loadSession(session.id, fullTitle);
            });
            
            // Tombol Rename (NEW)
            const renameBtn = document.createElement("button");
            renameBtn.className = 'session-action-btn rename-session-btn';
            renameBtn.innerHTML = '✏️'; 
            renameBtn.title = 'Ganti Nama Sesi';
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation(); 
                renameChatSession(session.id, fullTitle);
            });


            // Tombol Hapus 
            const deleteBtn = document.createElement("button");
            deleteBtn.className = 'session-action-btn delete-session-btn';
            deleteBtn.innerHTML = '🗑️'; 
            deleteBtn.title = 'Hapus Sesi';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); 
                deleteChatSession(session.id);
            });

            item.appendChild(titleElement);
            item.appendChild(renameBtn); // Tambahkan tombol rename
            item.appendChild(deleteBtn);
            historyList.appendChild(item);
        });

    } catch (e) {
        historyList.innerHTML = `<div style="padding:10px; font-size:13px; color:var(--accent-red);">❌ Gagal load riwayat sesi.</div>`;
        console.error("Error loading history sidebar:", e);
    }
};

// --- New Chat Logic (MODIFIKASI: Membuat Sesi Baru di DB) ---
const startNewChat = async (doConfirm = true) => {
    if (doConfirm && !confirm("Yakin ingin memulai obrolan baru? Riwayat percakapan saat ini akan hilang dari memori.")) {
        return;
    }
    
    if (currentUserId === "0") {
        alert("Autentikasi diperlukan untuk memulai sesi.");
        return;
    }

    setBusy(true);

    try {
        // 1. Buat Sesi Baru di DB via PHP
        const res = await fetch(PHP_API_BASE + "/session_management.php", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "start_session",
                user_id: currentUserId,
                title: "New Chat " + new Date().toLocaleTimeString(),
                cognitive: localStorage.getItem("cognitive") || "par",
                cq1: localStorage.getItem("cq1") || "t",
                cq2: localStorage.getItem("cq2") || "a",
            }),
        });

        const data = await res.json();
        if (data.status !== "success" || !data.session_id) {
            throw new Error(data.message || "Gagal mendapatkan ID sesi baru.");
        }

        // 2. Reset State JavaScript
        currentSessionId = data.session_id.toString();
        localStorage.setItem("lastSessionId", currentSessionId);
        
        currentStage = 'chat';
        correctAnswer = "";
        wrongAttempts = 0;
        
        // 3. Bersihkan Tampilan Chat
        const chatBox = $("#chatBox");
        if (chatBox) chatBox.innerHTML = `
            <div class="placeholder">
                <h1>Halo, <span id="welcomeUsername">${localStorage.getItem("username") || "Pengguna"}!</span></h1>
                <p>Sesi baru (ID: ${currentSessionId}) dimulai. Tulis pertanyaan atau topik di bawah ini.</p>
                <div id="profileSummary" class="profile-summary"></div>
            </div>
        `;

        initProfileFromStorage();
        
        // 4. Reset Input Bar dan Status
        setInputState('chat', "Tulis pertanyaan atau topik yang ingin kamu pelajari...");
        
        // 5. Muat ulang Sidebar Riwayat
        loadHistorySidebar();
        
    } catch (e) {
        alert("Gagal memulai sesi baru. Pastikan PHP/DB berjalan. Error: " + e.message);
        currentSessionId = "default";
    } finally {
        setBusy(false);
    }
};


// =========================================================
// EVENT HANDLER UTAMA (Kirim/Enter Logic)
// =========================================================

const handleSendButtonClick = () => {
    const mainInput = $("#mainInput");
    if (mainInput && !mainInput.disabled) {
        const inputValue = mainInput.value.trim();
        
        if (inputValue === "") {
            alert("Input tidak boleh kosong.");
            return;
        }
        
        if (currentStage === 'chat') {
            sendQuestion(inputValue);
        } else if (currentStage === 'evaluate') {
            evaluateAnswer(inputValue);
        }
    }
};

const handleInputKeydown = (e) => {
    const mainInput = $("#mainInput");
    
    // PERBAIKAN LOGIKA: Enter untuk KIRIM, Ctrl/Shift/Meta + Enter untuk NEWLINE
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); 
        handleSendButtonClick();
        // Reset tinggi setelah kirim
        if (mainInput) {
            mainInput.style.height = 'auto';
            mainInput.rows = 1;
        }
        return;
    }
    
    // Auto-expand textarea (Logic ini harus diaktifkan pada event 'input' juga)
    if (mainInput) {
        setTimeout(() => { 
            mainInput.style.height = 'auto';
            mainInput.style.height = mainInput.scrollHeight + 'px';
        }, 0);
    }
};


// =========================================================
// ENTRY POINT & LISTENERS UTAMA
// =========================================================

function setupMainApp() {
    if (!localStorage.getItem("username")) { window.location.href = "/static/login.html"; return; }
    
    loadMarked().then((m) => { markedLib = m; });
    loadMermaid().then((m) => { mermaidLib = m; }); // <-- LOAD MERMAID

    const mainInput = $("#mainInput");
    const storedUsername = localStorage.getItem("username") || "Pengguna";
    
    if ($("#welcomeUsername")) { $("#welcomeUsername").textContent = storedUsername; }
    if ($("#topbarUsername")) { $("#topbarUsername").innerHTML = `<span class="user-avatar-circle">🧑</span><span class="username-text">${storedUsername}</span>`; }
    
    initProfileFromStorage();

    // Inisialisasi sesi saat aplikasi dimuat
    if (currentSessionId === "default") {
        startNewChat(false); // Mulai sesi baru tanpa konfirmasi
    } else {
        // Jika ada lastSessionId, coba muat sesi tersebut
        const lastSessionTitle = "Sesi Terakhir"; // Judul dummy, akan diupdate di sidebar
        loadSession(currentSessionId, lastSessionTitle);
        loadHistorySidebar(); // Muat sidebar saat startup
    }
    
    setInputState('chat', "Tulis pertanyaan atau topik yang ingin kamu pelajari...");

    // Tombol Kirim/Evaluasi
    if ($("#sendBtn")) $("#sendBtn").addEventListener("click", handleSendButtonClick);
    // Tombol Enter/Newline
    if (mainInput) mainInput.addEventListener("keydown", handleInputKeydown);
    if (mainInput) mainInput.addEventListener("input", handleInputKeydown); 

    // Sidebar Listeners
    if ($("#downloadTxt")) $("#downloadTxt").addEventListener("click", downloadHistoryTxt);
    if ($("#downloadJson")) $("#downloadJson").addEventListener("click", downloadHistoryJson);
    if ($("#btnNewChat")) $("#btnNewChat").addEventListener("click", () => startNewChat(true));

    // Modal Listeners
    const btnUserDashboard = $("#btnUserDashboard");
    const userModalOverlay = $("#userDashboardOverlay");
    const btnCloseUserModal = $("#btnCloseUserModal");

    if (btnUserDashboard) btnUserDashboard.addEventListener("click", () => { 
        if (userModalOverlay) userModalOverlay.style.display = "flex";
        loadUserInfoForModal(); 
    });
    if (btnCloseUserModal && userModalOverlay) btnCloseUserModal.addEventListener("click", () => { userModalOverlay.style.display = "none"; });
    if (userModalOverlay) {
        userModalOverlay.addEventListener("click", (e) => {
          if (e.target === userModalOverlay) userModalOverlay.style.display = "none";
        });
    }

    // Tambahkan listener untuk Hapus Semua Chat
    const btnDeleteAllChats = $("#btnDeleteAllChats");
    if (btnDeleteAllChats) {
        btnDeleteAllChats.addEventListener("click", deleteAllChats);
    }
    
    // Logout Logic
    const btnLogoutMain = $("#btnLogoutMain");
    if (btnLogoutMain) {
        btnLogoutMain.addEventListener("click", () => {
            localStorage.clear();
            window.location.href = "/static/login.html";
        });
    }
}


document.addEventListener("DOMContentLoaded", () => {
    const path = window.location.pathname;

    if (path.includes("login.html")) {
        setupLoginPage();
    } else if (path.includes("register.html")) {
        setupRegisterPage();
    } else {
        setupMainApp(); 
    }
});
