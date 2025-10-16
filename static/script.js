/* =====================================================================
   CSIPBLLM — Personalized Learning Frontend Script
   FINAL VERSION (Dark/Light Toggle + Dynamic UI + Adaptive Hints + CT-Friendly)
   ---------------------------------------------------------------------
   Fitur:
   ✅ Manual Dark/Light Mode Toggle 🌞 / 🌙 (disimpan di localStorage)
   ✅ Mode dinamis (Input ↔ Evaluasi ↔ New Chat)
   ✅ Bot follow-up otomatis setelah menjawab
   ✅ Evaluasi adaptif (Directive → Remedial → Facilitative)
   ✅ Code-friendly (Computational Thinking)
   ✅ Riwayat percakapan + unduh TXT/JSON
   ✅ Input otomatis dikunci setelah pertanyaan dikirim
   ✅ Tombol ✨ New Chat untuk memulai ulang sesi
   ✅ Tidak ada fitur yang dihapus
   ===================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // ================================================================
  // 1. 🌓 THEME TOGGLE (Dark/Light Mode)
  // ================================================================
  const themeToggle = document.getElementById("themeToggle");

  const applyTheme = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.textContent = theme === "dark" ? "🌞" : "🌙";
  };

  const savedTheme = localStorage.getItem("theme");
  if (savedTheme) {
    applyTheme(savedTheme);
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }

  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("theme", next);
  });

  // ================================================================
  // 2. AMBIL ELEMEN DOM
  // ================================================================
  const sendBtn = document.getElementById("sendBtn");
  const evalBtn = document.getElementById("evalBtn");
  const chatBox = document.getElementById("chatBox");
  const userAnswer = document.getElementById("userAnswer");
  const evalResult = document.getElementById("evalResult");
  const answerSection = document.getElementById("answerSection");
  const historySection = document.getElementById("historySection");
  const questionInput = document.getElementById("question");
  const styleSelect = document.getElementById("style");
  const profesiInput = document.getElementById("profesi");
  const usiaInput = document.getElementById("usia");
  const downloadTxt = document.getElementById("downloadTxt");
  const downloadJson = document.getElementById("downloadJson");
  const inputSection = document.getElementById("inputSection");
  const newChatBtn = document.getElementById("newChatBtn");
  const newChatSection = document.getElementById("newChatSection");

  let correctAnswer = "";
  let currentStyle = "";
  let wrongCount = 0;

  // ================================================================
  // 3. UTILITAS
  // ================================================================
  const escapeHtml = (text) =>
    String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const renderMarkdown = (text) => {
    if (window.marked) return marked.parse(text, { breaks: true, gfm: true });
    return escapeHtml(text).replace(/\n/g, "<br>");
  };

  const appendBubble = (cls, html) => {
    const placeholder = chatBox.querySelector(".placeholder");
    if (placeholder) placeholder.remove();
    const div = document.createElement("div");
    div.className = `chat-bubble ${cls}`;
    div.innerHTML = html;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return div;
  };

  const showTyping = () => {
    const div = document.createElement("div");
    div.className = "chat-bubble status";
    div.textContent = "⋯ mengetik";
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return div;
  };

  const setBusy = (button, busy) => {
    if (button) button.disabled = busy;
  };

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

  const formatMessageWithProfile = (msg, prof, age) => {
    if (!prof && !age) return msg;
    if (prof && age) return `(${prof}, usia ${age}) ${msg}`;
    if (prof) return `(${prof}) ${msg}`;
    return `(usia ${age}) ${msg}`;
  };

  // ================================================================
  // 4. KIRIM PERTANYAAN (MODE INPUT → MODE EVALUASI)
  // ================================================================
  sendBtn.addEventListener("click", async () => {
    const message = questionInput.value.trim();
    const style = styleSelect.value;
    const profesi = profesiInput.value.trim();
    const usia = usiaInput.value.trim();

    if (!message) {
      alert("Tulis pertanyaan terlebih dahulu!");
      return;
    }

    appendBubble("user", `<b>Kamu:</b> ${escapeHtml(message)}`);
    const typing = showTyping();
    setBusy(sendBtn, true);

    // 🔒 Kunci input agar user tidak ubah konteks
    profesiInput.disabled = true;
    usiaInput.disabled = true;
    questionInput.disabled = true;
    styleSelect.disabled = true;
    sendBtn.disabled = true;

    try {
      const response = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: formatMessageWithProfile(message, profesi, usia),
          style,
        }),
      });

      const data = await response.json();
      typing.remove();

      appendBubble(
        "bot",
        `<b>GPT-OSS (${escapeHtml(data.style_main)}):</b><br>${renderMarkdown(
          data.reply_main
        )}`
      );

      appendBubble(
        "compare",
        `<b>Perbandingan (${escapeHtml(
          data.style_compare
        )}):</b><br>${renderMarkdown(data.reply_compare)}`
      );

      // Follow-up langsung dari /chat
      if (data.followup_question) {
        appendBubble("bot", `<i>💭 ${renderMarkdown(data.followup_question)}</i>`);
      }

      // Pindah ke mode evaluasi
      inputSection.style.display = "none";
      answerSection.style.display = "block";
      historySection.style.display = "none";
      newChatSection.style.display = "none";

      correctAnswer = data.reply_main;
      currentStyle = data.style_main;
      wrongCount = 0;
    } catch (err) {
      typing.remove();
      appendBubble("bot", `❌ Gagal memproses: ${escapeHtml(String(err))}`);
    } finally {
      setBusy(sendBtn, false);
    }
  });

  // ENTER = kirim
  questionInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  // ================================================================
  // 5. EVALUASI JAWABAN SISWA (ADAPTIVE HINT + FOLLOW-UP)
  // ================================================================
  evalBtn.addEventListener("click", async () => {
    const answer = userAnswer.value.trim();
    if (!answer) {
      alert("Tulis jawabanmu dulu!");
      return;
    }

    appendBubble("user", `<b>Jawaban Kamu:</b> ${escapeHtml(answer)}`);
    const scoring = showTyping();
    setBusy(evalBtn, true);

    try {
      const response = await fetch("/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answer,
          correct_answer: correctAnswer,
          wrong_count: wrongCount,
        }),
      });

      const data = await response.json();
      scoring.remove();

      if (data.is_correct) {
        wrongCount = 0;
        evalResult.className = "eval-result correct";
        evalResult.innerHTML = renderMarkdown(data.feedback || "");
        appendBubble(
          "bot",
          `✅ <b>Benar!</b> ${renderMarkdown(
            data.feedback
          )}<br><i>(Confirmatory Feedback)</i>`
        );
        historySection.style.display = "block";
        newChatSection.style.display = "block"; // tampilkan tombol New Chat
      } else {
        wrongCount++;
        evalResult.className = "eval-result incorrect";

        let hintLabel =
          wrongCount === 1
            ? "🧩 Directive Hint"
            : wrongCount === 2
            ? "🪜 Remedial Scaffold"
            : "🧭 Facilitative Step-by-Step Guide";

        appendBubble(
          "bot",
          `❌ <b>Salah (${wrongCount}×)</b><br>${renderMarkdown(
            data.feedback
          )}<br><i>${hintLabel}</i>`
        );

        evalResult.innerHTML = renderMarkdown(
          `${data.feedback}\n\n**${hintLabel}**`
        );

        // Follow-up question dari backend
        if (data.followup_question) {
          appendBubble(
            "bot",
            `<i>💭 ${renderMarkdown(data.followup_question)}</i>`
          );
        }
      }
    } catch (err) {
      scoring.remove();
      appendBubble("bot", `❌ Error evaluasi: ${escapeHtml(String(err))}`);
    } finally {
      setBusy(evalBtn, false);
    }
  });

  // ================================================================
  // 6. NEW CHAT BUTTON — RESET SEMUA
  // ================================================================
  newChatBtn.addEventListener("click", () => {
    chatBox.innerHTML = `<div class="placeholder">💬 Mulai percakapan dengan mengetik pertanyaan...</div>`;
    inputSection.style.display = "block";
    answerSection.style.display = "none";
    historySection.style.display = "none";
    newChatSection.style.display = "none";
    questionInput.value = "";
    userAnswer.value = "";
    evalResult.innerHTML = "";
    wrongCount = 0;

    // 🔓 Aktifkan kembali input
    profesiInput.disabled = false;
    usiaInput.disabled = false;
    questionInput.disabled = false;
    styleSelect.disabled = false;
    sendBtn.disabled = false;
  });

  // ================================================================
  // 7. UNDUH RIWAYAT (TXT & JSON)
  // ================================================================
  downloadTxt.addEventListener("click", async () => {
    try {
      const res = await fetch("/history?format=txt");
      const data = await res.json();
      const blob = new Blob([data.data || ""], { type: "text/plain" });
      triggerDownload(blob, "history.txt");
    } catch (err) {
      appendBubble("bot", `❌ Gagal unduh TXT: ${escapeHtml(String(err))}`);
    }
  });

  downloadJson.addEventListener("click", async () => {
    try {
      const res = await fetch("/history?format=json");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      triggerDownload(blob, "history.json");
    } catch (err) {
      appendBubble("bot", `❌ Gagal unduh JSON: ${escapeHtml(String(err))}`);
    }
  });
});