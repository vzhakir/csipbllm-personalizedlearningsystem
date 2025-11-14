/* =============================================================================
   CSIPBLLM — Adaptive Learning Frontend Script (Ultra XL Edition, Final Fixed)
   -----------------------------------------------------------------------------
   Fitur Utama:
   • Kirim pertanyaan (stream token-by-token via /chat_stream) + fallback /api/generate
   • Endpoint /chat FastAPI-native (422 fixed di backend) → di sini konsisten pakai API_BASE
   • Bubble "tiga titik mengetik" + typewriter rendering (cerdas)
   • Markdown ringan + blok kode + tombol salin
   • Auto-resize textarea + enter-to-send (Shift+Enter untuk baris baru)
   • Toast & error handling dengan retry/backoff & timeout fetch
   • Sidebar: rekomendasi belajar, riwayat lokal
   • Theme toggle (dark/light) + preferensi tersimpan
   • Status polling backend/ollama (periode dapat diatur)

   Tambahan:
   • Dual cognitive output: "Kognitif Pengguna" & "Kognitif Perbandingan"
   • Comprehension loop: bot bertanya → user jawab → /comprehension_check → loop sampai "mengerti"
   • NEW: Render bertahap (user → perbandingan → pertanyaan reflektif) tanpa menghapus mode lama
   ============================================================================= */

/* ============================== 0) KONFIGURASI ============================== */

const API_BASE = window.location.origin;           
const DEFAULT_MODEL = "deepseek-r1:8b";            
const STREAM_FIRST = false;                        
const USE_TYPEWRITER = true;                       
const MAX_TYPEWRITER_LEN = 6000;                   
const TYPEWRITER_DELAY = 9;                        
const FETCH_TIMEOUT_MS = 600_000;                  
const MAX_RETRY = 2;                               
const STATUS_POLL_MS = 20_000;                     
const HISTORY_SIDEBAR_MAX = 60;                    
const STORAGE_KEYS = {
  history: "csipbllm_chat_history",
  prefs: "csipbllm_prefs"
};

// NEW: render berurutan (user → perbandingan → pertanyaan)
const SEQUENTIAL_RENDER = true;

/* ============================== 1) ELEMEN DOM =============================== */

let chatBox;
let input;
let sendBtn;
let sidebar;
let sidebarToggle;
let clearBtn;
let recommendBtn;
let themeToggle;
let styleSelect;
let ageInput;
let professionInput;
let historyList;
let modelSelector;
let promptLabBtn;
let promptLabModal;
let promptLabInput;
let runPromptLabBtn;
let closePromptLab;
let promptLabResults;

/* ============================== 2) STATE APPS =============================== */

let historyData = [];             
let currentPrefs = {
  theme: "dark",
  model: DEFAULT_MODEL,
  style: "Visual",
  age: "19",
  profession: "Mahasiswa",
  stream: STREAM_FIRST,
  typewriter: USE_TYPEWRITER
};

// State comprehension loop
let pendingComprehension = null;

/* ========================== 3) UTIL: STORAGE & TIME ========================= */

function saveLocal(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}
function loadLocal(key, def = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : def;
  } catch {
    return def;
  }
}
function nowTime() {
  return new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/* ============================ 4) UTIL: TOAST UI ============================= */

function toast(message, type = "info") {
  const node = document.createElement("div");
  node.className = `toast toast-${type}`;
  node.textContent = message;
  document.body.appendChild(node);
  requestAnimationFrame(() => node.classList.add("show"));
  setTimeout(() => {
    node.classList.remove("show");
    setTimeout(() => node.remove(), 400);
  }, 3500);
}

/* ============================ 5) UTIL: FETCH WRAP ========================== */

async function fetchWithRetry(url, opts = {}, maxRetry = MAX_RETRY) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(t);
    return res;
  } catch (err) {
    clearTimeout(t);
    if (maxRetry > 0) {
      await delay(600 * (MAX_RETRY - maxRetry + 1)); 
      return fetchWithRetry(url, opts, maxRetry - 1);
    }
    throw err;
  }
}

/* =========================== 6) MARKDOWN + COPY BTN ======================== */

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderMarkdown(md = "") {
  md = md.replace(/```([\s\S]*?)```/g, (_, code) => {
    const safe = escapeHtml(code.trim());
    return `\n<pre class="code"><code>${safe}</code><button class="copy-btn" title="Salin kode">📋</button></pre>\n`;
  });

  md = md.replace(/`([^`]+)`/g, (_, code) => `<code class="inline">${escapeHtml(code)}</code>`);

  md = md.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  md = md.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  md = md.replace(/^### (.*)$/gm, "<h4>$1</h4>");
  md = md.replace(/^## (.*)$/gm, "<h3>$1</h3>");
  md = md.replace(/^# (.*)$/gm, "<h2>$1</h2>");

  md = md.replace(/^\s*-\s+(.*)$/gm, "<li>$1</li>");
  md = md.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");

  md = md
    .split(/\n{2,}/)
    .map((p) => (p.match(/^<h\d|^<ul|^<pre/) ? p : `<p>${p}</p>`))
    .join("\n");

  return md;
}

function attachCopyButtons(container) {
  container.querySelectorAll("pre.code .copy-btn").forEach((btn) => {
    btn.onclick = () => {
      const code = btn.parentElement.querySelector("code").innerText;
      navigator.clipboard.writeText(code || "").then(() => toast("Kode disalin!", "success"));
    };
  });
}

/* =========================== 7) UI: RENDER PESAN =========================== */

function messageNode(role, html) {
  const wrap = document.createElement("div");
  wrap.className = `message ${role} fade-in`;
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.innerHTML = html;
  wrap.appendChild(bubble);
  const time = document.createElement("div");
  time.className = "msg-time";
  time.textContent = nowTime();
  wrap.appendChild(time);
  return wrap;
}

function appendMessage(role, text, { markdown = true, id = null } = {}) {
  const html = markdown ? renderMarkdown(escapeHtml(text)) : renderMarkdown(text);
  const node = messageNode(role, html);
  if (id) node.id = id;
  chatBox.appendChild(node);
  attachCopyButtons(node);
  scrollToBottom();
  return node;
}

function appendTypingIndicator(id) {
  const node = document.createElement("div");
  node.className = "message bot fade-in";
  node.id = id;
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.innerHTML = `
    <div class="typing-indicator">
      <span></span><span></span><span></span>
    </div>`;
  node.appendChild(bubble);
  const time = document.createElement("div");
  time.className = "msg-time";
  time.textContent = nowTime();
  node.appendChild(time);
  chatBox.appendChild(node);
  scrollToBottom();
  return node;
}

function replaceBubbleHtml(node, html) {
  const bubble = node.querySelector(".msg-bubble");
  if (bubble) bubble.innerHTML = html;
  attachCopyButtons(node);
  scrollToBottom();
}

function scrollToBottom() {
  chatBox?.scrollTo({ top: chatBox.scrollHeight, behavior: "smooth" });
}

/* ===================== 8) TYPEWRITER RENDER (CERDAS) ====================== */

function isProbablyCode(text) {
  return /```|;\s*$|\bfor\b|\bwhile\b|\bif\b|\bdef\b|\bclass\b|\breturn\b/.test(text || "");
}

async function typewriterInto(node, text, delayMs = TYPEWRITER_DELAY) {
  const bubble = node.querySelector(".msg-bubble");
  if (!bubble) return;

  let i = 0;
  let out = "";
  while (i < text.length) {
    const ch = text[i];
    out += ch;

    bubble.innerHTML = escapeHtml(out).replace(/\n/g, "<br/>");

    if (".,!?".includes(ch)) {
      await delay(delayMs * 5);
    } else {
      await delay(delayMs);
    }

    i++;
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  bubble.innerHTML = renderMarkdown(escapeHtml(text));
  attachCopyButtons(node);
}

/* ========================= 9) HISTORY & SIDEBAR ============================ */

function loadHistoryLocal() {
  historyData = loadLocal(STORAGE_KEYS.history, []);
}

function saveHistoryLocal() {
  saveLocal(STORAGE_KEYS.history, historyData);
}

function pushHistoryLocal(prompt, response) {
  historyData.push({ prompt, response, ts: Date.now() });
  if (historyData.length > 1000) historyData = historyData.slice(-1000);
  saveHistoryLocal();
}

function renderHistorySidebar() {
  if (!historyList) return;
  historyList.innerHTML = "";
  const items = historyData.slice(-HISTORY_SIDEBAR_MAX).reverse();
  items.forEach((it) => {
    const li = document.createElement("li");
    li.textContent = it.prompt.slice(0, 70) + (it.prompt.length > 70 ? "…" : "");
    li.title = it.prompt;
    li.onclick = () => {
      appendMessage("user", it.prompt);
      appendMessage("bot", it.response);
      scrollToBottom();
    };
    historyList.appendChild(li);
  });
}

async function clearHistoryAll() {
  if (!confirm("Hapus semua riwayat?")) return;
  historyData = [];
  saveHistoryLocal();
  try { await fetchWithRetry(`${API_BASE}/api/history/clear`, { method: "POST" }); } catch {}
  chatBox.innerHTML = "";
  appendMessage("system", "🧹 Semua riwayat chat dihapus.", { markdown: false });
  renderHistorySidebar();
}

/* ========================= 10) STATUS & PREFS/THEME ======================== */

function applyTheme(theme) {
  document.body.classList.toggle("light", theme === "light");
  themeToggle.textContent = theme === "light" ? "🌞" : "🌙";
}

function initPrefs() {
  const p = loadLocal(STORAGE_KEYS.prefs, {});
  currentPrefs = { ...currentPrefs, ...p };
  applyTheme(currentPrefs.theme);

  if (styleSelect) styleSelect.value = currentPrefs.style;
  if (ageInput) ageInput.value = currentPrefs.age;
  if (professionInput) professionInput.value = currentPrefs.profession;
}

function savePrefs() {
  saveLocal(STORAGE_KEYS.prefs, currentPrefs);
}

async function pollStatus() {
  try {
    const res = await fetchWithRetry(`${API_BASE}/api/status`);
    const data = await res.json();
  } catch {} 
  finally {
    setTimeout(pollStatus, STATUS_POLL_MS);
  }
}

/* ===================== 11) REKOMENDASI & EVALUASI ========================= */

async function doRecommend() {
  const style = styleSelect.value || "Visual";
  appendMessage("info", `🔎 Menganalisis gaya belajar kamu (${style})...`, { markdown: false });

  try {
    const res = await fetchWithRetry(`${API_BASE}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ style }),
    });

    const data = await res.json();
    const tips = data.recommendations || [];

    if (!tips.length) {
      appendMessage("bot", "Tidak ada rekomendasi yang ditemukan.");
      return;
    }

    appendMessage("bot", `✨ Rekomendasi untuk gaya ${style}:\n- ${tips.join("\n- ")}`);
  } catch {
    appendMessage("error", "⚠️ Gagal mengambil rekomendasi.", { markdown: false });
  }
}

async function doEvaluate() {
  const answer = prompt("Masukkan jawabanmu:");
  const correct = prompt("Masukkan kunci jawaban:");
  if (!answer || !correct) return;

  try {
    const res = await fetchWithRetry(`${API_BASE}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer, correct_answer: correct, wrong_count: 0 }),
    });

    const data = await res.json();
    appendMessage("system", `🧠 Evaluasi: ${data.feedback || "(tidak ada feedback)"}`);

    if (data.followup_question)
      appendMessage("bot", data.followup_question);

  } catch {
    appendMessage("error", "⚠️ Error evaluasi.", { markdown: false });
  }
}

/* ====================== 12) KIRIM PESAN (STREAM + FALLBACK) ================ */

function buildContext() {
  return {
    style: styleSelect.value || currentPrefs.style || "Visual",
    age: ageInput.value || currentPrefs.age,
    profession: professionInput.value || currentPrefs.profession,
    model: currentPrefs.model || DEFAULT_MODEL
  };
}

async function sendMessage() {
  const questionOrReply = input?.value?.trim();
  if (!questionOrReply) return;

  appendMessage("user", questionOrReply);
  input.value = "";
  autoResize(input);

  if (pendingComprehension) {
    await handleComprehensionReply(questionOrReply);
    return;
  }

  const ctx = buildContext();

  const typingId = `typing-${Date.now()}`;
  const nodeTyping = appendTypingIndicator(typingId);

  try {
    if (currentPrefs.stream) {
      await streamChat(questionOrReply, ctx, nodeTyping);
    } else {
      await singleShotChat(questionOrReply, ctx, nodeTyping);
    }
  } catch (err) {
    try {
      await chatSimple(questionOrReply, ctx, nodeTyping);
    } catch (e2) {
      replaceBubbleHtml(nodeTyping, renderMarkdown(escapeHtml(`❌ Gagal memproses: ${e2?.message || e2}`)));
    }
  }
}

async function handleComprehensionReply(userAnswer) {
  const typingId = `typing-${Date.now()}`;
  const nodeTyping = appendTypingIndicator(typingId);

  const payload = {
    original_question: pendingComprehension.original_question,
    user_reply: userAnswer,
    user_style: pendingComprehension.user_style,
    compare_style: pendingComprehension.compare_style,
    last_bot_explanations: pendingComprehension.twin_explanations || ""
  };

  try {
    const res = await fetchWithRetry(`${API_BASE}/comprehension_check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (data.error) {
      replaceBubbleHtml(nodeTyping, renderMarkdown(escapeHtml(`⚠️ ${data.error}`)));
      return;
    }

    const understood = !!data.understood;
    const feedback = data.feedback || "";
    const nextQ = data.next_question || null;

    if (understood) {
      replaceBubbleHtml(nodeTyping, renderMarkdown(escapeHtml(`✅ Sepertinya kamu sudah mengerti! ${feedback}`)));
      pendingComprehension = null;
    } else {
      replaceBubbleHtml(nodeTyping,
        renderMarkdown(escapeHtml(`💡 ${feedback}\n\n🔁 ${nextQ || "Coba jelaskan kembali dengan katamu."}`))
      );
      pendingComprehension.last_followup = nextQ || pendingComprehension.last_followup;
    }

  } catch (e) {
    replaceBubbleHtml(nodeTyping, renderMarkdown(escapeHtml(`⚠️ Gagal menilai pemahaman: ${e?.message || e}`)));
  }
}

/* ----------------------------- STREAM MODE ------------------------------- */

async function streamChat(message, ctx, nodeTarget) {
  const payload = { message, ...ctx };

  const res = await fetchWithRetry(`${API_BASE}/chat_stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error("HTTP " + res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  replaceBubbleHtml(nodeTarget, "");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value || new Uint8Array());
    full += chunk;
    const bubble = nodeTarget.querySelector(".msg-bubble");
    bubble.innerHTML = escapeHtml(full).replace(/\n/g, "<br/>");
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  replaceBubbleHtml(nodeTarget, renderMarkdown(escapeHtml(full)));
  pushHistoryLocal(message, full);
}

/* ------------------------- SINGLE SHOT MODE (/api/generate) ------------------------- */

async function singleShotChat(message, ctx, nodeTarget) {
  const payload = { message, ...ctx };

  const res = await fetchWithRetry(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    replaceBubbleHtml(nodeTarget, renderMarkdown(escapeHtml(`⚠️ Server error ${res.status}`)));
    return;
  }

  const data = await res.json();

  if (SEQUENTIAL_RENDER) {
    await renderSequentialCognitive(nodeTarget, data, message, ctx);
    return;
  }

  const userCog = data.kognitif_pengguna || "";
  const otherCog = data.kognitif_perbandingan || "";
  const diffShort = data.perbedaan_pendekatan || "";
  const compareStyle = data.compare_style || "(lain)";
  const twin = data.twin_explanations || "";
  const follow = data.followup || "";

  const textFallback = data.response || "⚠️ Tidak ada respons.";
  const evalText = data.evaluation;
  const compareLegacy = data.comparison;

  if (userCog || otherCog) {
    replaceBubbleHtml(nodeTarget, renderMarkdown(escapeHtml(
      `## Kognitif Pengguna\n${userCog || "-"}\n\n## Kognitif Perbandingan (${compareStyle})\n${otherCog || "-"}`
    )));

    if (diffShort) appendMessage("compare", `📊 Perbedaan (ringkas):\n${diffShort}`);

  } else {
    const txt = twin || textFallback;
    replaceBubbleHtml(nodeTarget, renderMarkdown(escapeHtml(txt)));
  }

  if (evalText) appendMessage("eval", "💡 Evaluasi: " + evalText, { markdown: false });
  if (compareLegacy) appendMessage("compare", "📊 Perbandingan: " + compareLegacy, { markdown: false });

  if (follow) {
    appendMessage("bot", "🔁 " + follow, { markdown: false });
    pendingComprehension = {
      original_question: message,
      user_style: ctx.style || "Visual",
      compare_style: compareStyle,
      twin_explanations: twin || (`## Kognitif Pengguna\n${userCog}\n\n## Kognitif Perbandingan\n${otherCog}`),
      last_followup: follow
    };
  }

  pushHistoryLocal(message, twin || textFallback);
}

/* ----------------------------- SIMPLE CHAT (/chat) ----------------------------- */

async function chatSimple(message, ctx, nodeTarget) {
  const res = await fetchWithRetry(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: message,
      model: ctx.model,
      style: ctx.style,
      age: ctx.age,
      profession: ctx.profession
    }),
  });

  if (!res.ok) throw new Error("HTTP " + res.status);

  const data = await res.json();
  const text = data?.answer || "⚠️ Tidak ada jawaban.";

  replaceBubbleHtml(nodeTarget, renderMarkdown(escapeHtml(text)));
  pushHistoryLocal(message, text);
}

/* ========================= 13) AUTO-RESIZE TEXTAREA ======================== */

function autoResize(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 220) + "px";
}

/* 13.1) NEW RENDER SEKUENSIAL ============================= */

async function renderSequentialCognitive(nodeTarget, data, message, ctx) {
  const userCog = data.kognitif_pengguna || "";
  const otherCog = data.kognitif_perbandingan || "";
  const compareStyle = data.compare_style || "(lain)";
  const follow = data.followup || data.reflective_question || "";
  const twin = data.twin_explanations || (
    `## Kognitif Pengguna (${ctx.style})\n${userCog}\n\n` +
    `## Kognitif Perbandingan (${compareStyle})\n${otherCog}`
  );

  const userBlock = `## Kognitif Pengguna\n${userCog || "-"}`;
  replaceBubbleHtml(nodeTarget, renderMarkdown(escapeHtml(userBlock)));
  await delay(150);

  const otherBlock = `## Kognitif Perbandingan (${compareStyle})\n${otherCog || "-"}`;
  appendMessage("bot", otherBlock);
  await delay(120);

  if (follow) {
    appendMessage("bot", "🔁 " + follow, { markdown: false });
    pendingComprehension = {
      original_question: message,
      user_style: ctx.style,
      compare_style: compareStyle,
      twin_explanations: twin,
      last_followup: follow
    };
  }

  pushHistoryLocal(message, twin);
}

/* ================================ 14) INIT & EVENTS ================================ */

function bindDom() {
  chatBox = document.getElementById("chatBox");
  input = document.getElementById("question");
  sendBtn = document.getElementById("sendBtn");
  sidebar = document.getElementById("sidebar");
  sidebarToggle = document.getElementById("sidebarToggle");
  clearBtn = document.getElementById("clearBtn");
  recommendBtn = document.getElementById("recommendBtn");
  themeToggle = document.getElementById("themeToggle");
  styleSelect = document.getElementById("style");
  ageInput = document.getElementById("age");
  professionInput = document.getElementById("profession");
  historyList = document.getElementById("historyList");
  modelSelector = document.getElementById("modelSelector");
  promptLabBtn = document.getElementById("promptLabBtn");
  promptLabModal = document.getElementById("promptLabModal");
  promptLabInput = document.getElementById("promptLabInput");
  runPromptLabBtn = document.getElementById("runPromptLab");
  closePromptLab = document.getElementById("closePromptLab");
  promptLabResults = document.getElementById("promptLabResults");
}

function bindEvents() {
  sendBtn?.addEventListener("click", sendMessage);

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  input?.addEventListener("input", () => autoResize(input));

  sidebarToggle?.addEventListener("click", () => {
    if (!sidebar) return;
    const isHidden = sidebar.classList.contains("hidden");
    sidebar.classList.toggle("hidden", !isHidden);
    sidebarToggle.setAttribute("aria-expanded", isHidden ? "true" : "false");
  });

  clearBtn?.addEventListener("click", clearHistoryAll);
  recommendBtn?.addEventListener("click", doRecommend);

  themeToggle?.addEventListener("click", () => {
    currentPrefs.theme = document.body.classList.contains("light") ? "dark" : "light";
    applyTheme(currentPrefs.theme);
    savePrefs();
  });

  // ⭐⭐⭐ Tambahan Prompt Engineering Lab — TEMPATKAN DI SINI
  promptLabBtn?.addEventListener("click", () => {
    promptLabModal.classList.remove("hidden");
  });

  closePromptLab?.addEventListener("click", () => {
    promptLabModal.classList.add("hidden");
  });

  runPromptLabBtn?.addEventListener("click", runPromptLabExperiment);
}

/* -------------------------- INIT MODEL SELECTOR ------------------------------ */

async function initModelSelector() {
  if (!modelSelector) return;

  try {
    const res = await fetch(`${API_BASE}/api/models`);
    const data = await res.json();
    const models = data.models || [];

    if (models.length === 0) return;

    modelSelector.innerHTML = "";
    models.forEach(m => {
      const op = document.createElement("option");
      op.value = m;
      op.textContent = m;
      if (m === currentPrefs.model) op.selected = true;
      modelSelector.appendChild(op);
    });

    modelSelector.classList.remove("hidden");

    modelSelector.onchange = async () => {
      const mdl = modelSelector.value;
      currentPrefs.model = mdl;
      savePrefs();
      toast("Model diganti ke: " + mdl, "info");

      await fetch(`${API_BASE}/api/set_model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: mdl })
      });
    };
  } catch (err) {
    console.warn("Gagal load models:", err);
  }
}

// =====================================================
// PROMPT ENGINEERING LAB — MAIN FUNCTION (Bagian C)
// =====================================================
async function runPromptLabExperiment() {
  const query = promptLabInput.value.trim();
  if (!query) {
    toast("Masukkan prompt terlebih dahulu.", "error");
    return;
  }

  promptLabResults.innerHTML = "<p class='muted'>⏳ Menjalankan eksperimen...</p>";

  try {
    const res = await fetchWithRetry(`${API_BASE}/api/prompt_experiments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });

    const data = await res.json();

    if (data.error) {
      promptLabResults.innerHTML = `<p class="text-red">⚠️ ${data.error}</p>`;
      return;
    }

    promptLabResults.innerHTML = `
      <h3>📌 Query:</h3>
      <pre>${escapeHtml(query)}</pre>

      <h3>1️⃣ Zero-Shot</h3>
      <pre>${escapeHtml(data.zero_shot)}</pre>

      <h3>2️⃣ Few-Shot</h3>
      <pre>${escapeHtml(data.few_shot)}</pre>

      <h3>3️⃣ Chain-of-Thought (CoT)</h3>
      <pre>${escapeHtml(data.chain_of_thought)}</pre>

      <h3>4️⃣ Structured Prompting</h3>
      <pre>${escapeHtml(data.structured)}</pre>
    `;

  } catch (e) {
    promptLabResults.innerHTML = `<p class='text-red'>⚠️ Gagal memproses: ${e}</p>`;
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  bindDom();
  bindEvents();
  loadHistoryLocal();
  renderHistorySidebar();
  initPrefs();
  autoResize(input);

  if (!historyData.length) {
    appendMessage("bot", "👋 Halo! Aku siap membantu pembelajaranmu hari ini.");
    appendMessage("info", "Tulis pertanyaanmu untuk memulai percakapan interaktif.", { markdown: false });
  } else {
    appendMessage("info", "🔄 Selamat datang kembali! Riwayat chat kamu telah dimuat.", { markdown: false });
  }

  initModelSelector();
  pollStatus();
});
