const form = document.getElementById("user-form");
const resultDiv = document.getElementById("result");
const downloadDiv = document.getElementById("download-buttons");
const txtBtn = document.getElementById("download-txt");
const jsonBtn = document.getElementById("download-json");

let sessionId = null;

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const formData = new FormData(form);
  const baseData = {
    profesi: formData.get("profesi"),
    umur: parseInt(formData.get("umur")),
    tipe_kognitif: formData.get("tipe_kognitif"),
    pertanyaan: formData.get("pertanyaan"),
  };

  await sendMessage(baseData, baseData.pertanyaan);
  downloadDiv.style.display = "block"; // tampilkan tombol download
});

async function sendMessage(userData, pertanyaan, mountEl = resultDiv) {
  const chatDiv = document.createElement("div");
  chatDiv.className = "stage";
  chatDiv.innerHTML = `<h3>Pertanyaan:</h3><p>${pertanyaan}</p><p>⏳ Memuat jawaban...</p>`;
  mountEl.appendChild(chatDiv);

  const formData = new FormData();
  formData.append("profesi", userData.profesi);
  formData.append("umur", userData.umur);
  formData.append("tipe_kognitif", userData.tipe_kognitif);
  formData.append("pertanyaan", pertanyaan);
  if (sessionId) formData.append("session_id", sessionId);

  const res = await fetch("/chat", { method: "POST", body: formData });
  const data = await res.json();

  if (!sessionId) sessionId = data.session_id;

  chatDiv.innerHTML = `<h3>Pertanyaan:</h3><p>${pertanyaan}</p><h3>Jawaban:</h3><p>${data.answer}</p>`;

  // Form untuk pertanyaan berikutnya
  const nextForm = document.createElement("form");
  nextForm.innerHTML = `
    <label>Pertanyaan Lanjutan / Jawaban Anda:</label><br>
    <input type="text" name="pertanyaan" required>
    <button type="submit">Kirim</button>
  `;
  chatDiv.appendChild(nextForm);

  nextForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nextQuestion = nextForm.pertanyaan.value;
    await sendMessage(userData, nextQuestion, mountEl);
  });
}

// Download tombol
txtBtn.addEventListener("click", () => {
  if (sessionId) {
    window.open(`/download_history?session_id=${sessionId}&format=txt`, "_blank");
  } else {
    alert("Belum ada sesi aktif.");
  }
});

jsonBtn.addEventListener("click", () => {
  if (sessionId) {
    window.open(`/download_history?session_id=${sessionId}&format=json`, "_blank");
  } else {
    alert("Belum ada sesi aktif.");
  }
});
