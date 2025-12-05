// script.js – Semua logic frontend (login, register, main app)

const PHP_API_BASE = "http://127.0.0.1:8001"; // sesuaikan kalau port PHP beda

// =========================================================
// HELPER UMUM
// =========================================================
const $ = (sel) => document.querySelector(sel);
const getTrim = (el) => (el ? el.value.trim() : "");
const getRaw = (el, fb = "") =>
  el && typeof el.value === "string" ? el.value : fb;

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
  if (!markedLib) {
    return String(text || "")
      .split("\n")
      .map((l) => `<p>${escapeHtml(l)}</p>`)
      .join("");
  }
  try {
    return markedLib.parse(text || "");
  } catch {
    return String(text || "")
      .split("\n")
      .map((l) => `<p>${escapeHtml(l)}</p>`)
      .join("");
  }
};

// =========================================================
// SETUP: LOGIN PAGE
// =========================================================
function setupLoginPage() {
  // kalau sudah login, lempar ke halaman utama
  if (localStorage.getItem("username")) {
    window.location.href = "/";
    return;
  }

  const loginUsername = $("#loginUsername");
  const loginPassword = $("#loginPassword");
  const loginError = $("#loginError");
  const btnLogin = $("#btnLogin");

  const setBusy = (b) => {
    if (!btnLogin) return;
    btnLogin.disabled = b;
    btnLogin.textContent = b ? "Memproses..." : "Masuk";
  };

  async function doLogin() {
    if (!loginUsername || !loginPassword || !loginError) return;

    loginError.textContent = "";
    const username = loginUsername.value.trim();
    const password = loginPassword.value.trim();

    if (!username || !password) {
      loginError.textContent = "Username dan password wajib diisi.";
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(PHP_API_BASE + "/login.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      console.log("DEBUG login:", data);

      if (data.status !== "success") {
        loginError.textContent = data.message || "Login gagal.";
        return;
      }

      if (data.user_id) localStorage.setItem("user_id", data.user_id);
      if (data.username) localStorage.setItem("username", data.username);
      if (data.cognitive) localStorage.setItem("cognitive", data.cognitive);
      if (data.cq1) localStorage.setItem("cq1", data.cq1);
      if (data.cq2) localStorage.setItem("cq2", data.cq2);

      window.location.href = "/";
    } catch (err) {
      console.error("Login error:", err);
      loginError.textContent = "Tidak bisa terhubung ke server login.";
    } finally {
      setBusy(false);
    }
  }

  if (btnLogin) btnLogin.addEventListener("click", doLogin);
  if (loginPassword) {
    loginPassword.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    });
  }
}

// =========================================================
// SETUP: REGISTER PAGE
// =========================================================
function setupRegisterPage() {
  if (localStorage.getItem("username")) {
    window.location.href = "/";
    return;
  }

  const regUsername = $("#regUsername");
  const regPassword = $("#regPassword");
  const regCognitive = $("#regCognitive");
  const regCq1 = $("#regCq1");
  const regCq2 = $("#regCq2");
  const registerError = $("#registerError");
  const btnRegister = $("#btnRegister");

  const setBusy = (b) => {
    if (!btnRegister) return;
    btnRegister.disabled = b;
    btnRegister.textContent = b ? "Memproses..." : "Daftar";
  };

  async function doRegister() {
    if (!regUsername || !regPassword || !registerError) return;

    registerError.textContent = "";
    const username = regUsername.value.trim();
    const password = regPassword.value.trim();
    const cognitive = regCognitive ? regCognitive.value.trim() : "";
    const cq1 = regCq1 ? regCq1.value.trim() : "";
    const cq2 = regCq2 ? regCq2.value.trim() : "";

    if (!username || !password) {
      registerError.textContent = "Username dan password wajib diisi.";
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(PHP_API_BASE + "/register.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, cognitive, cq1, cq2 }),
      });

      const data = await res.json();
      console.log("DEBUG register:", data);

      if (data.status !== "success") {
        registerError.textContent = data.message || "Registrasi gagal.";
        return;
      }

      if (data.user_id) localStorage.setItem("user_id", data.user_id);
      if (data.username) localStorage.setItem("username", data.username);
      if (data.cognitive) localStorage.setItem("cognitive", data.cognitive);
      if (data.cq1) localStorage.setItem("cq1", data.cq1);
      if (data.cq2) localStorage.setItem("cq2", data.cq2);

      window.location.href = "/";
    } catch (err) {
      console.error("Register error:", err);
      registerError.textContent = "Tidak bisa terhubung ke server registrasi.";
    } finally {
      setBusy(false);
    }
  }

  if (btnRegister) btnRegister.addEventListener("click", doRegister);
  if (regPassword) {
    regPassword.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doRegister();
    });
  }
}

// =========================================================
// SETUP: MAIN APP (INDEX.HTML)
// =========================================================
function setupMainApp() {
  // kalau belum login, paksa ke login
  if (!localStorage.getItem("username")) {
    window.location.href = "/static/login.html";
    return;
  }

  loadMarked()
    .then((m) => {
      markedLib = m;
    })
    .catch((e) => console.warn("marked gagal load:", e));

  const sendBtn = $("#sendBtn");
  const evalBtn = $("#evalBtn");
  const chatBox = $("#chatBox");
  const userAnswer = $("#userAnswer");
  const evalResult = $("#evalResult");
  const answerSection = $("#answerSection");
  const historySection = $("#historySection");
  const questionInput = $("#question");
  const cognitiveSelect = $("#cognitive");
  const cq1Select = $("#cq1");
  const cq2Select = $("#cq2");
  const modeSelect = $("#mode");
  const profileSection = $(".profile-section");
  const profileSummary = $("#profileSummary");
  const cognitiveWrapper = $("#cognitiveWrapper");
  const downloadTxt = $("#downloadTxt");
  const downloadJson = $("#downloadJson");
  const followupSection = $("#followupSection");
  const followupText = $("#followupText");
  const followupStage = $("#followupStage");
  const historyButtons = $("#historyButtons");

  let correctAnswer = "";
  let wrongAttempts = 0;

  const setBusy = (btn, busy) => {
    if (!btn) return;
    btn.disabled = busy;
  };

  const appendBubble = (role, html) => {
    if (!chatBox) return null;
    const placeholder = chatBox.querySelector(".placeholder");
    if (placeholder) placeholder.remove();

    const div = document.createElement("div");
    div.className = `chat-bubble ${role}`;
    div.innerHTML = html;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return div;
  };

  // ---- init profile from localStorage ----
  const initProfileFromStorage = () => {
    const storedUser = localStorage.getItem("username");
    const storedCognitive = localStorage.getItem("cognitive") || "";
    const storedCq1 = localStorage.getItem("cq1") || "";
    const storedCq2 = localStorage.getItem("cq2") || "";

    if (storedCognitive && cognitiveSelect)
      cognitiveSelect.value = storedCognitive;
    if (storedCq1 && cq1Select) cq1Select.value = storedCq1;
    if (storedCq2 && cq2Select) cq2Select.value = storedCq2;

    const haveFullProfile =
      storedCognitive !== "" && storedCq1 !== "" && storedCq2 !== "";

    if (haveFullProfile) {
      if (profileSection) profileSection.classList.add("hidden-profile");

      if (profileSummary) {
        const cogLabel =
          storedCognitive === "tar"
            ? "TAR — Theoretical-Analytical"
            : "PAR — Practical-Analytical";

        const cqMap = {
          p: "P — Praktis / Project",
          t: "T — Teoretis / Thinking",
          a: "A — Analitis / Abstract",
          none: "NONE",
        };

        const cq1Label = cqMap[storedCq1] || "-";
        const cq2Label = cqMap[storedCq2] || "-";
        const name = storedUser || "Pengguna";

        profileSummary.innerHTML = `
          Profil terdeteksi untuk <b>${escapeHtml(name)}</b>:<br/>
          Tipe Kognitif: <b>${escapeHtml(cogLabel)}</b><br/>
          CQ1: <b>${escapeHtml(cq1Label)}</b>, CQ2: <b>${escapeHtml(
          cq2Label
        )}</b>.
        `;
        profileSummary.style.display = "block";
      }
    } else {
      if (profileSection) profileSection.classList.remove("hidden-profile");
      if (profileSummary) {
        profileSummary.style.display = "none";
        profileSummary.innerHTML = "";
      }
    }
  };

  initProfileFromStorage();

  // ---- /chat ----
  const sendQuestion = async () => {
    const message = getTrim(questionInput);
    if (!message) {
      alert("Tulis pertanyaan dulu.");
      return;
    }
  const cognitive =
    localStorage.getItem("cognitive") || getRawValue(cognitiveSelect, "par");
  const cq1 =
    localStorage.getItem("cq1") || getRawValue(cq1Select, "t");
  const cq2 =
    localStorage.getItem("cq2") || getRawValue(cq2Select, "a");
  const mode = getRawValue(modeSelect, "accurate");

    appendBubble("user", `<b>Kamu:</b> ${escapeHtml(message)}`);
    const loading = appendBubble(
      "bot",
      "<b>Bot:</b> ⏳ Menyusun jawaban..."
    );

    if (answerSection) answerSection.style.display = "none";
    if (historySection) historySection.style.display = "none";
    if (followupSection) followupSection.style.display = "none";
    if (historyButtons) historyButtons.style.display = "none";
    correctAnswer = "";
    wrongAttempts = 0;
    if (evalResult) evalResult.textContent = "";

    setBusy(sendBtn, true);
    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: message,
          cognitive,
          cq1,
          cq2,
          mode,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (loading) loading.remove();

      const ragMeta =
        data.meta && data.meta.rag_used
          ? `<div class="rag-meta">🔎 RAG: ${
              data.meta.source_count || 0
            } sumber digunakan.</div>`
          : `<div class="rag-meta">🤖 Jawaban utama tanpa RAG tambahan.</div>`;

      const html = `<b>Bot:</b><br/>${ragMeta}${renderMarkdown(
        data.answer || ""
      )}`;
      appendBubble("bot", html);

      correctAnswer = data.correct_answer || "";
      const followup = data.followup || null;

      if (correctAnswer && answerSection)
        answerSection.style.display = "block";

      if (followup && followupSection && followupText && followupStage) {
        followupSection.style.display = "block";
        followupText.innerHTML = renderMarkdown(followup.text || "");
        followupStage.textContent = `Stage: ${followup.stage || "-"}`;
      }

      if (historySection && historyButtons) {
        historySection.style.display = "block";
        historyButtons.style.display = "flex";
      }
    } catch (e) {
      console.error(e);
      if (loading) loading.remove();
      appendBubble(
        "bot",
        `<b>Bot:</b> ❌ Terjadi error saat memproses pertanyaan: ${escapeHtml(
          String(e)
        )}`
      );
    } finally {
      setBusy(sendBtn, false);
    }
  };

  // ---- /evaluate ----
  const evaluateAnswer = async () => {
    const userText = getTrim(userAnswer);
    if (!userText) {
      alert("Tulis jawaban dulu.");
      return;
    }
    if (!correctAnswer) {
      alert("Belum ada jawaban kunci.");
      return;
    }

    setBusy(evalBtn, true);
    if (evalResult)
      evalResult.textContent = "⏳ Menilai jawaban kamu...";

    try {
      const res = await fetch("/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_answer: userText,
          correct_answer: correctAnswer,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      wrongAttempts = data.is_correct ? 0 : wrongAttempts + 1;

      const status = data.is_correct
        ? "✅ Jawabanmu sudah tepat!"
        : "❌ Jawabanmu masih perlu diperbaiki.";
      const detail = data.feedback || "";
      const score = data.score ?? "-";

      if (evalResult) {
        evalResult.innerHTML = `
          <div class="eval-score">Skor: <b>${score}</b>/100</div>
          <div>${status}</div>
          <div style="margin-top:4px;">${renderMarkdown(detail)}</div>
        `;
      }
    } catch (e) {
      console.error(e);
      if (evalResult)
        evalResult.textContent = `Error menilai jawaban: ${String(e)}`;
    } finally {
      setBusy(evalBtn, false);
    }
  };

  // ---- history ----
  const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadHistoryTxt = async () => {
    try {
      const res = await fetch("/history?format=txt");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      triggerDownload(new Blob([txt], { type: "text/plain" }), "history.txt");
    } catch (e) {
      console.error(e);
      appendBubble(
        "bot",
        `❌ Gagal mengunduh riwayat TXT: ${escapeHtml(String(e))}`
      );
    }
  };

  const downloadHistoryJson = async () => {
    try {
      const res = await fetch("/history?format=json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      triggerDownload(
        new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        }),
        "history.json"
      );
    } catch (e) {
      console.error(e);
      appendBubble(
        "bot",
        `❌ Gagal mengunduh riwayat JSON: ${escapeHtml(String(e))}`
      );
    }
  };

  // ---- event utama ----
  if (sendBtn) sendBtn.addEventListener("click", sendQuestion);
  if (questionInput) {
    questionInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendQuestion();
      }
    });
  }

  if (evalBtn) evalBtn.addEventListener("click", evaluateAnswer);
  if (userAnswer) {
    userAnswer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        evaluateAnswer();
      }
    });
  }

  if (downloadTxt) downloadTxt.addEventListener("click", downloadHistoryTxt);
  if (downloadJson) downloadJson.addEventListener("click", downloadHistoryJson);

  // ---- auth topbar ----
  const topbarUsername = $("#topbarUsername");
  if (topbarUsername) {
    topbarUsername.textContent =
      localStorage.getItem("username") || "Pengguna";
  }

  const btnLogoutMain = $("#btnLogoutMain");
  if (btnLogoutMain) {
    btnLogoutMain.addEventListener("click", () => {
      try {
        fetch(PHP_API_BASE + "/logout.php", { method: "POST" }).catch(() => {});
      } catch (e) {
        console.warn("logout error:", e);
      }

      localStorage.removeItem("username");
      localStorage.removeItem("user_id");
      localStorage.removeItem("cognitive");
      localStorage.removeItem("cq1");
      localStorage.removeItem("cq2");

      window.location.href = "/static/login.html";
    });
  }

  // ---- user dashboard popup ----
  const btnUserDashboard = $("#btnUserDashboard");
  const userModalOverlay = $("#userDashboardOverlay");
  const btnCloseUserModal = $("#btnCloseUserModal");
  const btnDeleteUser = $("#btnDeleteUser");

  const udUsername = $("#udUsername");
  const udCognitive = $("#udCognitive");
  const udCq1 = $("#udCq1");
  const udCq2 = $("#udCq2");
  const udCreatedAt = $("#udCreatedAt");
  const udDebug = $("#udDebug");

  function openUserModal() {
    if (!userModalOverlay) return;
    userModalOverlay.style.display = "flex";
    loadUserInfoForModal();
  }

  function closeUserModal() {
    if (!userModalOverlay) return;
    userModalOverlay.style.display = "none";
  }

  async function loadUserInfoForModal() {
    const userId = localStorage.getItem("user_id");
    const username = localStorage.getItem("username") || "-";
    const cognitive = localStorage.getItem("cognitive") || "";
    const cq1 = localStorage.getItem("cq1") || "";
    const cq2 = localStorage.getItem("cq2") || "";

    if (udUsername) udUsername.textContent = username;
    if (udDebug) udDebug.textContent = "";

    const mapCog = {
      par: "PAR — Practical-Analytical",
      tar: "TAR — Theoretical-Analytical",
      "": "Belum diatur",
    };
    const mapCq = {
      t: "T — Teoretis / Thinking",
      a: "A — Analitis / Abstract",
      p: "P — Praktis / Project",
      "": "-",
    };

    if (udCognitive)
      udCognitive.textContent = mapCog[cognitive] || cognitive || "Belum diatur";
    if (udCq1) udCq1.textContent = mapCq[cq1] || cq1 || "-";
    if (udCq2) udCq2.textContent = mapCq[cq2] || cq2 || "-";
    if (udCreatedAt) udCreatedAt.textContent = "-";

    if (!userId) {
      if (udDebug)
        udDebug.textContent =
          "user_id tidak ada di localStorage (mungkin login versi lama).";
      return;
    }

    try {
      const res = await fetch(PHP_API_BASE + "/userinfo.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: Number(userId) }),
      });
      const data = await res.json();
      console.log("DEBUG userinfo:", data);

      if (data.status === "success" && data.user) {
        const u = data.user;
        if (udUsername && u.username) udUsername.textContent = u.username;
        if (udCognitive && u.cognitive)
          udCognitive.textContent = mapCog[u.cognitive] || u.cognitive;
        if (udCq1 && u.cq1) udCq1.textContent = mapCq[u.cq1] || u.cq1;
        if (udCq2 && u.cq2) udCq2.textContent = mapCq[u.cq2] || u.cq2;
        if (udCreatedAt && u.created_at)
          udCreatedAt.textContent = u.created_at;
      } else if (udDebug) {
        udDebug.textContent = "Gagal mengambil data user dari server.";
      }
    } catch (err) {
      console.error("userinfo error:", err);
      if (udDebug) udDebug.textContent = "Error koneksi ke userinfo.php";
    }
  }

  if (btnUserDashboard)
    btnUserDashboard.addEventListener("click", openUserModal);
  if (btnCloseUserModal)
    btnCloseUserModal.addEventListener("click", closeUserModal);
  if (userModalOverlay) {
    userModalOverlay.addEventListener("click", (e) => {
      if (e.target === userModalOverlay) closeUserModal();
    });
  }

  if (btnDeleteUser) {
    btnDeleteUser.addEventListener("click", async () => {
      const userId = localStorage.getItem("user_id");
      if (!userId) {
        alert("user_id tidak ditemukan. Coba login ulang dulu.");
        return;
      }

      const sure = confirm(
        "Yakin ingin menghapus akun ini? Tindakan ini permanen dan tidak bisa dibatalkan."
      );
      if (!sure) return;

      try {
        const res = await fetch(PHP_API_BASE + "/delete_user.php", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: Number(userId) }),
        });
        const data = await res.json();
        console.log("DEBUG delete_user:", data);

        if (data.status === "success") {
          alert("Akun berhasil dihapus.");
          localStorage.clear();
          window.location.href = "/static/register.html";
        } else {
          alert("Gagal menghapus akun: " + (data.message || "unknown error"));
        }
      } catch (err) {
        console.error("delete_user error:", err);
        alert("Error koneksi ke delete_user.php");
      }
    });
  }
}

// =========================================================
// ENTRY POINT: DETEKSI HALAMAN
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;

  if (path.includes("login.html")) {
    setupLoginPage();
  } else if (path.includes("register.html")) {
    setupRegisterPage();
  } else {
    setupMainApp(); // diasumsikan index.html / halaman utama
  }
});
