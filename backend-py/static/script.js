// script.js – Logika Frontend Lengkap (Chatbot, Login, Register, Modal)

const PHP_API_BASE = "http://127.0.0.1:8001"; 

// =========================================================
// HELPER UMUM & MARKDOWN
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

const loadMarked = () =>
  new Promise((resolve, reject) => {
    if (window.marked) return resolve(window.marked);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/marked@12.0.1/marked.min.js";
    s.onload = () => resolve(window.marked);
    s.onerror = () => reject(new Error("Gagal memuat library markdown"));
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

let currentStage = 'chat'; // 'chat' atau 'evaluate'
let correctAnswer = "";
let wrongAttempts = 0;

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
// LOGIKA UTAMA: CHAT & EVALUATE (Ke Backend Python FastAPI)
// =========================================================

const sendQuestion = async (message) => {
    if (!message) { alert("Tulis pertanyaan dulu."); return; }

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
            body: JSON.stringify({ question: message, cognitive, cq1, cq2, mode, prompt_style }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        if (loading) loading.remove();

        // Jawaban Utama
        const mainHeader = `Tutor (${data.cognitive_main} | Latensi: ${data.latency_main_s.toFixed(2)}s | Style: ${data.prompt_style_main.toUpperCase()})`;
        const mainReplyText = data.reply_main || "❌ Model gagal memberikan jawaban."; 
        const ragMeta = data.used_rag ? `<div class="rag-meta">🔎 RAG: ${data.rag_mode} (Materi tambahan digunakan).</div>` : `<div class="rag-meta">🤖 Jawaban utama tanpa RAG tambahan.</div>`;

        const mainHtml = `<b>${escapeHtml(mainHeader)}:</b><br/>${ragMeta}${renderMarkdown(mainReplyText)}`;
        appendBubble("bot", mainHtml);

        // Jawaban Perbandingan
        if (data.reply_compare) {
            const compareHeader = `Sudut Pandang Lain (${data.cognitive_compare} | CQ1:${data.cq1_compare}/CQ2:${data.cq2_compare})`;
            const compareHtml = `<b>${escapeHtml(compareHeader)}:</b><br/>${renderMarkdown(data.reply_compare)}`;
            appendBubble("compare", compareHtml);
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

    appendBubble("user", `<b>[JAWABAN] Kamu:</b> ${escapeHtml(userText)}`);
    const loading = appendBubble("status", "<b>Bot:</b> ⏳ Menilai jawaban kamu...");
    
    setBusy(true);

    try {
        const res = await fetch("/evaluate", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_answer: userText, correct_answer: correctAnswer, wrong_count: wrongAttempts }),
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
        appendBubble("bot", `<b>Tutor (Feedback):</b><br/>${evalHtml}`);

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

    } catch (e) {
        if (loading) loading.remove();
        appendBubble("bot", `<b>Bot:</b> ❌ Error menilai jawaban: ${escapeHtml(String(e))}`);
        setInputState('evaluate', "Tulis perbaikan jawabanmu berdasarkan petunjuk di atas...");
    } finally {
        setBusy(false);
    }
};

// --- Download History (FITUR PENTING) ---
const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

const downloadHistoryTxt = async () => {
    try {
      const res = await fetch("/history?format=txt");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const txt = data.data || "Belum ada riwayat percakapan.";
      triggerDownload(new Blob([txt], { type: "text/plain" }), "history.txt");
    } catch (e) {
      appendBubble("bot", `❌ Gagal mengunduh riwayat TXT: ${escapeHtml(String(e))}`);
    }
};

const downloadHistoryJson = async () => {
    try {
      const res = await fetch("/history?format=json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      triggerDownload(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "history.json");
    } catch (e) {
      appendBubble("bot", `❌ Gagal mengunduh riwayat JSON: ${escapeHtml(String(e))}`);
    }
};


// =========================================================
// PHP API CLIENT (LOGIN, REGISTER, USER INFO) - FITUR PENTING
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


// --- Register Logic ---
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

// --- Login Logic ---
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

      } else if (udDebug) {
        udDebug.textContent = "Gagal mengambil data user dari server.";
      }
    } catch (err) {
      if (udDebug) udDebug.textContent = "Error koneksi ke userinfo.php";
    }
}

// --- Init Profile Summary (Fitur Penting) ---
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

// --- History Sidebar Logic ---
const loadHistorySidebar = async () => {
    const historyList = $("#historyList");
    if (!historyList) return;
    
    historyList.innerHTML = `<div class="loading-history">⏳ Memuat riwayat...</div>`;
    
    try {
        const res = await fetch("/history?format=json");
        const data = await res.json();

        if (!res.ok || !data.history) throw new Error("Gagal fetch history.");

        historyList.innerHTML = ''; 
        if (data.history.length === 0) {
            historyList.innerHTML = `<div style="padding:10px; font-size:13px;">Belum ada riwayat.</div>`;
            return;
        }

        data.history.slice(-20).reverse().forEach((conv, index) => {
            const title = (conv.user_message || "Untitled Chat").substring(0, 30);
            
            const item = document.createElement("div");
            item.className = 'history-item';
            item.textContent = title;
            item.dataset.index = index; 
            
            item.addEventListener('click', () => {
                alert(`Fungsi memuat riwayat lama: ${title} (Index: ${index}) belum diimplementasikan.`);
            });
            
            historyList.appendChild(item);
        });

    } catch (e) {
        historyList.innerHTML = `<div style="padding:10px; font-size:13px; color:var(--accent-red);">❌ Gagal load riwayat.</div>`;
        console.error("Error loading history sidebar:", e);
    }
};

// --- New Chat Logic (FITUR PENTING) ---
const startNewChat = () => {
    if (!confirm("Yakin ingin memulai obrolan baru? Riwayat percakapan saat ini akan hilang.")) {
        return;
    }
    
    // 1. Reset State JavaScript
    currentStage = 'chat';
    correctAnswer = "";
    wrongAttempts = 0;
    
    // 2. Bersihkan Tampilan Chat
    const chatBox = $("#chatBox");
    if (chatBox) chatBox.innerHTML = `
        <div class="placeholder">
            <h1>Halo, <span id="welcomeUsername">${localStorage.getItem("username") || "Pengguna"}!</span></h1>
            <p>Sesi baru dimulai. Tulis pertanyaan atau topik di bawah ini.</p>
            <div id="profileSummary" class="profile-summary"></div>
        </div>
    `;

    initProfileFromStorage();
    
    // 3. Reset Input Bar dan Status
    setInputState('chat', "Tulis pertanyaan atau topik yang ingin kamu pelajari...");
    
    // 4. Muat ulang Sidebar Riwayat
    loadHistorySidebar();
    
    console.log("Sesi obrolan baru dimulai.");
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

    const mainInput = $("#mainInput");
    const storedUsername = localStorage.getItem("username") || "Pengguna";
    
    if ($("#welcomeUsername")) { $("#welcomeUsername").textContent = storedUsername; }
    if ($("#topbarUsername")) { $("#topbarUsername").innerHTML = `<span class="user-avatar-circle">🧑</span><span class="username-text">${storedUsername}</span>`; }
    
    initProfileFromStorage();
    loadHistorySidebar(); // Muat sidebar saat startup

    setInputState('chat', "Tulis pertanyaan atau topik yang ingin kamu pelajari...");

    // Tombol Kirim/Evaluasi
    if ($("#sendBtn")) $("#sendBtn").addEventListener("click", handleSendButtonClick);
    // Tombol Enter/Newline
    if (mainInput) mainInput.addEventListener("keydown", handleInputKeydown);
    if (mainInput) mainInput.addEventListener("input", handleInputKeydown); 

    // Sidebar Listeners
    if ($("#downloadTxt")) $("#downloadTxt").addEventListener("click", downloadHistoryTxt);
    if ($("#downloadJson")) $("#downloadJson").addEventListener("click", downloadHistoryJson);
    if ($("#btnNewChat")) $("#btnNewChat").addEventListener("click", startNewChat);

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
