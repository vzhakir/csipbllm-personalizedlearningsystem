// ================================================================
// Asisten Belajar Interaktif - Script Utama (Verbose Version)
// ================================================================

// Ambil elemen form dan tempat hasil
const form = document.getElementById("user-form");
const resultDiv = document.getElementById("result");

// Session global agar setiap interaksi user masih satu konteks
let sessionId = null;

// ================================================================
// EVENT: Saat user menekan tombol "Mulai Bertanya"
// ================================================================
form.addEventListener("submit", async (e) => {
  e.preventDefault(); // cegah reload halaman
  resultDiv.innerHTML = ""; // kosongkan hasil sebelumnya

  // Ambil semua input dari form
  const formData = new FormData(form);
  const baseData = {
    profesi: formData.get("profesi"),
    umur: parseInt(formData.get("umur")),
    tipe_kognitif: formData.get("tipe_kognitif"),
    pertanyaan: formData.get("pertanyaan"),
  };

  // ==============================================================
  // Pilih 1 tipe pembanding secara acak selain tipe utama user
  // ==============================================================
  const allTypes = ["visual", "auditori", "kinestetik"].filter(
    (t) => t !== baseData.tipe_kognitif
  );
  const shuffled = allTypes.sort(() => Math.random() - 0.5);
  const [compareType] = shuffled.slice(0, 1);

  // ==============================================================
  // Siapkan grid tampilan hasil jawaban (dua kolom)
  // ==============================================================
  const grid = document.createElement("div");
  grid.className = "compare-grid";
  resultDiv.appendChild(grid);

  // Buat dua kolom (kiri untuk tipe utama user, kanan untuk pembanding)
  const left = document.createElement("div");
  left.className = "compare-col";

  const right = document.createElement("div");
  right.className = "compare-col";

  grid.appendChild(left);
  grid.appendChild(right);

  // ==============================================================
  // Tambahkan header untuk masing-masing kolom
  // ==============================================================
  const hL = document.createElement("div");
  hL.className = "compare-header";
  hL.textContent = `Menurut ${baseData.tipe_kognitif}:`;
  left.appendChild(hL);

  const hR = document.createElement("div");
  hR.className = "compare-header";
  hR.textContent = `Menurut ${compareType}:`;
  right.appendChild(hR);

  // ==============================================================
  // Elemen untuk menampilkan jawaban dari AI
  // ==============================================================
  const stageDivL = document.createElement("div");
  const stageDivR = document.createElement("div");

  stageDivL.className = "stage";
  stageDivR.className = "stage";

  // Tampilkan status awal (loading)
  stageDivL.innerHTML = `<p>⏳ Sedang memuat jawaban untuk tipe ${baseData.tipe_kognitif}...</p>`;
  stageDivR.innerHTML = `<p>⏳ Sedang memuat jawaban untuk tipe ${compareType}...</p>`;

  left.appendChild(stageDivL);
  right.appendChild(stageDivR);

  // ==============================================================
  // Kirim data pertanyaan ke backend (Ollama API)
  // ==============================================================
  const formReq = new FormData();
  formReq.append("profesi", baseData.profesi);
  formReq.append("umur", baseData.umur);
  formReq.append("tipe_kognitif", baseData.tipe_kognitif);
  formReq.append("pertanyaan", baseData.pertanyaan);
  if (sessionId) formReq.append("session_id", sessionId);

  // Ambil hasil dari backend
  const response = await fetch("/ask", { method: "POST", body: formReq });
  const data = await response.json();
  if (!sessionId) sessionId = data.session_id;

  // ==============================================================
  // Efek mengetik (typing animation)
  // ==============================================================
  await typeText(stageDivL, data.answer_visual || data.answer);
  await typeText(stageDivR, data.answer_compare || data.answer_compare_type);

  // ==============================================================
  // Setelah dua jawaban selesai → AI balik bertanya ke user
  // ==============================================================
  askBackToUser(baseData);
});

// ================================================================
// Fungsi efek mengetik - biar seperti ChatGPT
// ================================================================
async function typeText(el, text) {
  el.innerHTML = "";
  const p = document.createElement("p");
  el.appendChild(p);

  // Ngetik huruf demi huruf biar smooth
  for (let i = 0; i < text.length; i++) {
    p.textContent += text[i];
    await new Promise((r) => setTimeout(r, 10)); // jeda antar huruf
  }
}

// ================================================================
// Fungsi untuk membuat form jawaban user setelah AI menjelaskan
// ================================================================
async function askBackToUser(userData) {
  const followDiv = document.createElement("div");
  followDiv.className = "stage";

  // Teks pengantar untuk user
  followDiv.innerHTML = `
    <h3>🧠 Sekarang giliran kamu!</h3>
    <p>Coba jelaskan kembali dengan bahasamu sendiri agar saya tahu kamu sudah mengerti.</p>
    <form id="user-answer-form" class="answer-form">
      <textarea name="jawaban_user" rows="4" placeholder="Tulis jawabanmu di sini..." required></textarea>
      <button type="submit" class="submit-answer">Kirim Jawaban</button>
    </form>
  `;

  resultDiv.appendChild(followDiv);

  // Tangani saat user kirim jawaban
  const formAnswer = followDiv.querySelector("#user-answer-form");

  formAnswer.addEventListener("submit", async (e) => {
    e.preventDefault();
    const jawaban_user = formAnswer.jawaban_user.value;

    // Kirim jawaban user untuk divalidasi ke backend
    const checkForm = new FormData();
    checkForm.append("profesi", userData.profesi);
    checkForm.append("umur", userData.umur);
    checkForm.append("tipe_kognitif", userData.tipe_kognitif);
    checkForm.append("pertanyaan", userData.pertanyaan);
    checkForm.append("jawaban_user", jawaban_user);
    if (sessionId) checkForm.append("session_id", sessionId);

    followDiv.innerHTML = `<p>⏳ Mengevaluasi jawabanmu...</p>`;

    const res = await fetch("/check_answer", {
      method: "POST",
      body: checkForm,
    });

    const hasil = await res.json();

    // ============================================================
    // Tampilkan hasil evaluasi: benar atau salah
    // ============================================================
    const feedbackDiv = document.createElement("div");
    feedbackDiv.className = "feedback";

    if (hasil.correct) {
      // Jika jawaban user benar
      feedbackDiv.innerHTML = `
        <p>✅ <strong>Benar!</strong> ${hasil.feedback}</p>
        <p>Kamu sudah memahami konsep ini dengan baik 🎉</p>
      `;

      followDiv.replaceWith(feedbackDiv);

      // Munculkan tombol download riwayat
      showDownloadButtons();
    } else {
      // Jika jawaban belum tepat
      feedbackDiv.innerHTML = `
        <p>❌ <strong>Belum tepat:</strong> ${hasil.feedback}</p>
        <p>Coba pikirkan lagi dan kirim ulang jawabanmu.</p>
      `;

      followDiv.replaceWith(feedbackDiv);

      // Ulangi lagi pertanyaan sampai user paham
      askBackToUser(userData);
    }
  });
}

// ================================================================
// Fungsi menampilkan tombol download setelah user mengerti
// ================================================================
function showDownloadButtons() {
  const btnGroup = document.createElement("div");
  btnGroup.style.marginTop = "1.5rem";
  btnGroup.style.display = "flex";
  btnGroup.style.gap = "0.5rem";
  btnGroup.style.justifyContent = "center";

  // Tombol download TXT
  const txtBtn = document.createElement("button");
  txtBtn.textContent = "📥 Download TXT";
  txtBtn.type = "button";
  txtBtn.className = "download-btn txt-btn";
  txtBtn.onclick = () => {
    if (sessionId) {
      window.open(`/download_history?session_id=${sessionId}&format=txt`, "_blank");
    }
  };

  // Tombol download JSON
  const jsonBtn = document.createElement("button");
  jsonBtn.textContent = "📥 Download JSON";
  jsonBtn.type = "button";
  jsonBtn.className = "download-btn json-btn";
  jsonBtn.onclick = () => {
    if (sessionId) {
      window.open(`/download_history?session_id=${sessionId}&format=json`, "_blank");
    }
  };

  btnGroup.appendChild(txtBtn);
  btnGroup.appendChild(jsonBtn);
  resultDiv.appendChild(btnGroup);
}

// ================================================================
// (Optional) Utility tambahan kalau mau efek fade-in typing
// ================================================================
function fadeIn(el) {
  el.style.opacity = 0;
  let op = 0;
  const timer = setInterval(() => {
    if (op >= 1) clearInterval(timer);
    el.style.opacity = op;
    op += 0.1;
  }, 30);
}
