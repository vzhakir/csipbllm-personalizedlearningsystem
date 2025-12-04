/* ================================================================
   CSIPBLLM — Frontend Script
   Sinkron dengan FastAPI (ollamaapi.py) versi kognitif PAR/TAR + CQ
   Tanpa PHP / Auth, tapi fitur tetap lengkap (chat + eval + history)
   ================================================================ */

document.addEventListener("DOMContentLoaded", () => {
  // ===========================================================
  // 1. Load marked.js untuk render markdown di chat
  // ===========================================================
  const loadMarked = () =>
    new Promise((resolve, reject) => {
      if (window.marked) {
        resolve(window.marked);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
      script.onload = () => resolve(window.marked);
      script.onerror = () => reject(new Error("Gagal memuat marked.js"));
      document.head.appendChild(script);
    });

  loadMarked().catch((err) => console.error("marked.js error:", err));

  // ===========================================================
  // 2. Ambil elemen DOM
  // ===========================================================
  const sendBtn = document.getElementById("sendBtn");
  const evalBtn = document.getElementById("evalBtn");
  const chatBox = document.getElementById("chatBox");
  const userAnswer = document.getElementById("userAnswer");
  const evalResult = document.getElementById("evalResult");
  const answerSection = document.getElementById("answerSection");
  const historySection = document.getElementById("historySection");
  const questionInput = document.getElementById("question");
  const cognitiveSelect = document.getElementById("cognitive");
  const cq1Select = document.getElementById("cq1");
  const cq2Select = document.getElementById("cq2");
  const profesiInput = document.getElementById("profesi");
  const usiaInput = document.getElementById("usia");
  const downloadTxt = document.getElementById("downloadTxt");
  const downloadJson = document.getElementById("downloadJson");
  const followupSection = document.getElementById("followupSection");
  const followupText = document.getElementById("followupText");
  const followupStage = document.getElementById("followupStage");
  const historyButtons = document.getElementById("historyButtons");
  const modeSelect = document.getElementById("mode");

  // ===========================================================
  // 3. State global
  // ===========================================================
  let correctAnswer = "";   // jawaban referensi dari bot
  let wrongAttempts = 0;    // jumlah salah untuk evaluasi adaptif

  // ===========================================================
  // 4. Utilitas umum
  // ===========================================================
  const escapeHtml = (text) =>
    (text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const renderMarkdown = (md) => {
    if (!window.marked) return escapeHtml(md);
    return window.marked.parse(md || "");
  };

  const getTrimmedValue = (el) =>
    el && typeof el.value === "string" ? el.value.trim() : "";

  const getRawValue = (el, fallback = "") => {
    if (!el) return fallback;
    return el.value !== "" ? el.value : fallback;
  };

  const appendBubble = (role, html) => {
    if (!chatBox) return null;
    const placeholder = chatBox.querySelector(".placeholder");
    if (placeholder) {
      placeholder.remove();
    }

    const div = document.createElement("div");
    div.className = `bubble bubble-${role}`;
    div.innerHTML = html;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return div;
  };

  const setBusy = (btn, busy) => {
    if (!btn) return;
    btn.disabled = busy;
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

  const renderFollowupQuestion = (followup) => {
    if (!followupSection || !followupText || !followupStage) return;
    if (!followup || !followup.text) {
      followupSection.style.display = "none";
      followupText.textContent = "";
      followupStage.textContent = "";
      return;
    }
    followupSection.style.display = "block";
    followupStage.style.display = "block";
    followupStage.textContent = followup.stage || "Pertanyaan lanjutan";
    followupText.textContent = followup.text;
  };

  // ===========================================================
  // 5. Fungsi kirim pertanyaan ke /chat (FastAPI, PAR/TAR + CQ)
  // ===========================================================
  const sendQuestion = async () => {
    const message = getTrimmedValue(questionInput);
    const cognitive = getRawValue(cognitiveSelect, "par");
    const cq1 = getRawValue(cq1Select, "t");
    const cq2 = getRawValue(cq2Select, "a");
    const mode = getRawValue(modeSelect, "accurate"); // 🔹 BARU
    const profesi = getTrimmedValue(profesiInput);
    const usia = getTrimmedValue(usiaInput);
    
    if (!message) {
      alert("Tulis pertanyaan terlebih dahulu!");
      return;
    }

    appendBubble("user", `<b>Kamu:</b> ${escapeHtml(message)}`);
    const loading = appendBubble("status", "<i>Memproses jawaban...</i>");
    setBusy(sendBtn, true);
    wrongAttempts = 0;
    renderFollowupQuestion(null);
    if (historyButtons) historyButtons.style.display = "none";

    try {
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: formatMessageWithProfile(message, profesi, usia),
          cognitive, // dikonsumsi oleh backend kognitif
          cq1,
          cq2,
          mode,
          // session_id bisa ditambah kalau mau multi-user
        }),
      });

      const data = await res.json();
      if (loading) loading.remove();

      // Backend kognitif mengirim:
      // cognitive_main, cq1_main, cq2_main, cognitive_compare, cq1_compare, cq2_compare
      const mainHeader = `GPT-OSS (${data.cognitive_main} | CQ: ${data.cq1_main}, ${data.cq2_main})`;
      const compareHeader = `Perbandingan (${data.cognitive_compare} | CQ: ${data.cq1_compare}, ${data.cq2_compare})`;
      const ragInfo = data.use_rag
        ? `RAG ${data.rag_mode || "simple"}`
        : "RAG tidak digunakan (jawaban dari pengetahuan model)";

      appendBubble(
        "bot",
        `<div class ="rag-meta">${escapeHtml(ragInfo)}</div>`
        `<b>${escapeHtml(mainHeader)}:</b><br>${renderMarkdown(
          data.reply_main || ""
        )}`
      );

      appendBubble(
        "compare",
        `<b>${escapeHtml(compareHeader)}:</b><br>${renderMarkdown(
          data.reply_compare || ""
        )}`
      );

      renderFollowupQuestion({ text: data.followup_question || "" });

      // simpan sebagai "jawaban referensi" untuk /evaluate
      correctAnswer = data.reply_main || "";
      if (answerSection) answerSection.style.display = "block";
      if (historySection) historySection.style.display = "block";
    } catch (err) {
      if (loading) loading.remove();
      appendBubble(
        "bot",
        `❌ Gagal memproses: ${escapeHtml(String(err))}`
      );
    } finally {
      setBusy(sendBtn, false);
    }
  };

  // Tombol kirim & enter di textarea pertanyaan
  if (sendBtn) {
    sendBtn.addEventListener("click", sendQuestion);
  }
  if (questionInput) {
    questionInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendQuestion();
      }
    });
  }

  // ===========================================================
  // 6. Evaluasi jawaban siswa lewat /evaluate
  // ===========================================================
  const evaluateAnswer = async () => {
    const answer = getTrimmedValue(userAnswer);
    if (!answer) {
      alert("Tulis jawabanmu dulu!");
      return;
    }
    if (!correctAnswer) {
      alert("Belum ada jawaban referensi dari bot. Kirim pertanyaan dulu.");
      return;
    }

    setBusy(evalBtn, true);
    evalResult.textContent = "Menilai jawaban...";

    try {
      const res = await fetch("/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answer,
          correct_answer: correctAnswer,
          wrong_count: wrongAttempts,
          // session_id kalau mau dihubungkan ke user tertentu
        }),
      });

      const data = await res.json();
      if (!data.is_correct) wrongAttempts += 1;

      const statusText = data.is_correct
        ? "✅ Jawabanmu dianggap BENAR oleh sistem."
        : "❌ Jawabanmu BELUM tepat.";

      evalResult.classList.remove("correct", "incorrect");
      if (data.is_correct) {
        evalResult.classList.add("correct");
        if (historyButtons) historyButtons.style.display = "block";
      } else {
        evalResult.classList.add("incorrect");
      }

      evalResult.innerHTML = `
        <p><b>${escapeHtml(statusText)}</b></p>
        <p><b>Feedback:</b><br>${renderMarkdown(data.feedback || "")}</p>
        <p><b>Tahap Bantuan:</b> ${escapeHtml(
          data.hint_level || "Evaluasi awal"
        )}</p>
        <p><b>Pertanyaan Lanjutan:</b><br>${escapeHtml(
          data.followup_question || "-"
        )}</p>
      `;
    } catch (err) {
      evalResult.classList.remove("correct", "incorrect");
      evalResult.textContent = `❌ Gagal evaluasi: ${String(err)}`;
    } finally {
      setBusy(evalBtn, false);
    }
  };

  if (evalBtn) {
    evalBtn.addEventListener("click", evaluateAnswer);
  }
  if (userAnswer) {
    userAnswer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        // Ctrl+Enter untuk cepat submit evaluasi
        e.preventDefault();
        evaluateAnswer();
      }
    });
  }

  // ===========================================================
  // 7. Download history dari FastAPI (/history)
  // ===========================================================
  if (downloadTxt) {
    downloadTxt.addEventListener("click", async () => {
      try {
        const res = await fetch("/history?format=txt");
        const data = await res.json();
        const blob = new Blob([data.data || ""], { type: "text/plain" });
        triggerDownload(blob, "history.txt");
      } catch (err) {
        appendBubble(
          "bot",
          `❌ Gagal mengunduh TXT: ${escapeHtml(String(err))}`
        );
      }
    });
  }

  if (downloadJson) {
    downloadJson.addEventListener("click", async () => {
      try {
        const res = await fetch("/history?format=json");
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        });
        triggerDownload(blob, "history.json");
      } catch (err) {
        appendBubble(
          "bot",
          `❌ Gagal mengunduh JSON: ${escapeHtml(String(err))}`
        );
      }
    });
  }
});
