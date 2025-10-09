/* =====================================================================
   CSIPBLLM — Personalized Learning Frontend Script (FULL VERBOSE)
   ---------------------------------------------------------------------
   Fitur:
   - Kirim pertanyaan ke backend (ollamaapi.py)
   - Mendapatkan jawaban dengan gaya belajar
   - Render hasil chat dalam format Markdown (via marked.js)
   - Evaluasi jawaban siswa
   - Unduh riwayat percakapan (txt/json)
   - Semua fungsi disertai komentar dan keamanan XSS
   ===================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // ================================================================
  // 1. LOAD LIBRARY MARKED.JS UNTUK PARSING MARKDOWN
  // ================================================================
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
  script.defer = true;
  document.head.appendChild(script);

  // ================================================================
  // 2. DEKLARASI ELEMEN DOM YANG DIGUNAKAN
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

  // ================================================================
  // 3. VARIABEL STATE
  // ================================================================
  let correctAnswer = "";
  let currentStyle = "";

  // ================================================================
  // 4. FUNGSI UTILITY
  // ================================================================

  // Escape HTML untuk keamanan dari XSS
  const escapeHtml = (text) => {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // Render teks dengan Markdown formatting
  const renderMarkdown = (text) => {
    if (window.marked) {
      return marked.parse(text, {
        breaks: true,
        gfm: true,
      });
    }
    // fallback kalau marked belum loaded
    return escapeHtml(text).replace(/\n/g, "<br>");
  };

  // Tambah bubble chat baru
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

  // Aktifkan / nonaktifkan tombol sementara proses berjalan
  const setBusy = (button, busy) => {
    if (button) button.disabled = busy;
  };

  // Fungsi unduh file blob
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

  // Tambah profesi dan usia ke pertanyaan
  const formatMessageWithProfile = (msg, prof, age) => {
    if (!prof && !age) return msg;
    if (prof && age) return `(${prof}, usia ${age}) ${msg}`;
    if (prof) return `(${prof}) ${msg}`;
    return `(usia ${age}) ${msg}`;
  };

  // ================================================================
  // 5. EVENT: KIRIM PERTANYAAN KE BACKEND
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
    const loading = appendBubble("status", "<i>Memproses jawaban...</i>");
    setBusy(sendBtn, true);

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
      loading.remove();

      // Bubble jawaban utama
      appendBubble(
        "bot",
        `<b>GPT-OSS (${escapeHtml(data.style_main)}):</b><br>${renderMarkdown(
          data.reply_main
        )}`
      );

      // Bubble perbandingan gaya lain
      appendBubble(
        "compare",
        `<b>Perbandingan (${escapeHtml(
          data.style_compare
        )}):</b><br>${renderMarkdown(data.reply_compare)}`
      );

      // Simpan jawaban benar untuk evaluasi
      correctAnswer = data.reply_main;
      currentStyle = data.style_main;

      // Tampilkan area evaluasi & unduhan
      answerSection.style.display = "block";
      historySection.style.display = "block";
    } catch (err) {
      loading.remove();
      appendBubble("bot", `❌ Gagal memproses: ${escapeHtml(String(err))}`);
    } finally {
      setBusy(sendBtn, false);
    }
  });

  // ================================================================
  // 6. EVENT: EVALUASI JAWABAN SISWA
  // ================================================================
  evalBtn.addEventListener("click", async () => {
    const answer = userAnswer.value.trim();
    if (!answer) {
      alert("Tulis jawabanmu dulu!");
      return;
    }

    appendBubble("user", `<b>Jawaban Kamu:</b> ${escapeHtml(answer)}`);
    const scoring = appendBubble("status", "<i>Menilai jawaban kamu...</i>");
    setBusy(evalBtn, true);

    try {
      const response = await fetch("/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, correct_answer: correctAnswer }),
      });

      const data = await response.json();
      scoring.remove();

      evalResult.className = "eval-result " + (data.is_correct ? "correct" : "incorrect");
      evalResult.innerHTML = renderMarkdown(data.feedback || "");

      appendBubble(
        "bot",
        data.is_correct
          ? `✅ <b>Benar!</b> ${renderMarkdown(data.feedback)}`
          : `❌ <b>Salah.</b> ${renderMarkdown(data.feedback)}`
      );
    } catch (err) {
      scoring.remove();
      appendBubble("bot", `❌ Error evaluasi: ${escapeHtml(String(err))}`);
    } finally {
      setBusy(evalBtn, false);
    }
  });

  // ================================================================
  // 7. EVENT: UNDUH RIWAYAT (TXT)
  // ================================================================
  downloadTxt.addEventListener("click", async () => {
    try {
      const res = await fetch("/history?format=txt");
      const data = await res.json();
      const blob = new Blob([data.data || ""], { type: "text/plain" });
      triggerDownload(blob, "history.txt");
    } catch (err) {
      appendBubble("bot", `❌ Gagal mengunduh TXT: ${escapeHtml(String(err))}`);
    }
  });

  // ================================================================
  // 8. EVENT: UNDUH RIWAYAT (JSON)
  // ================================================================
  downloadJson.addEventListener("click", async () => {
    try {
      const res = await fetch("/history?format=json");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      triggerDownload(blob, "history.json");
    } catch (err) {
      appendBubble("bot", `❌ Gagal mengunduh JSON: ${escapeHtml(String(err))}`);
    }
  });
});
