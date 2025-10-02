const form = document.getElementById("user-form");
const resultDiv = document.getElementById("result");
let currentStage = 1;
let sessionId = null; // simpan session id global

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  resultDiv.innerHTML = "";

  const formData = new FormData(form);
  const baseData = {
    profesi: formData.get("profesi"),
    umur: parseInt(formData.get("umur")),
    tipe_kognitif: formData.get("tipe_kognitif"),
    pertanyaan: formData.get("pertanyaan"),
  };

  currentStage = 1;

  // Tombol download histori
  const btnGroup = document.createElement("div");
  btnGroup.style.marginBottom = "1rem";

  const txtBtn = document.createElement("button");
  txtBtn.textContent = "📥 Download TXT";
  txtBtn.type = "button";
  txtBtn.onclick = () => {
    if (sessionId) {
      window.open(`/download_history?session_id=${sessionId}&format=txt`, "_blank");
    } else {
      alert("Belum ada sesi aktif.");
    }
  };

  const jsonBtn = document.createElement("button");
  jsonBtn.textContent = "📥 Download JSON";
  jsonBtn.type = "button";
  jsonBtn.style.marginLeft = "0.5rem";
  jsonBtn.onclick = () => {
    if (sessionId) {
      window.open(`/download_history?session_id=${sessionId}&format=json`, "_blank");
    } else {
      alert("Belum ada sesi aktif.");
    }
  };

  btnGroup.appendChild(txtBtn);
  btnGroup.appendChild(jsonBtn);
  resultDiv.appendChild(btnGroup);

  // Pilih 2 tipe random
  const allTypes = ["visual", "auditori", "kinestetik"];
  const shuffled = allTypes.sort(() => Math.random() - 0.5);
  const [leftType, rightType] = shuffled.slice(0, 2);

  const grid = document.createElement("div");
  grid.className = "compare-grid";
  resultDiv.appendChild(grid);

  const left = document.createElement("div");
  left.className = "compare-col";
  const right = document.createElement("div");
  right.className = "compare-col";
  grid.appendChild(left);
  grid.appendChild(right);

  const hL = document.createElement("div");
  hL.className = "compare-header";
  hL.textContent = `Tipe kognitif: ${leftType}`;
  left.appendChild(hL);

  const hR = document.createElement("div");
  hR.className = "compare-header";
  hR.textContent = `Tipe kognitif: ${rightType}`;
  right.appendChild(hR);

  await Promise.all([
    handleStage(baseData, 1, left, leftType),
    handleStage(baseData, 1, right, rightType),
  ]);
});

async function handleStage(
  userData,
  stage,
  mountEl = resultDiv,
  overrideType = null
) {
  const stageTitleMap = { 1: "Hint Umum", 2: "Hint Visual", 3: "Jawaban Lengkap" };
  const stageTitle = stageTitleMap[stage] || `Penjelasan Lanjutan`;

  const stageDiv = document.createElement("div");
  stageDiv.className = "stage";
  stageDiv.innerHTML = `<h3>Tahap ${stage} — ${stageTitle}</h3><p>⏳ Memuat hint...</p>`;
  mountEl.appendChild(stageDiv);

  const payloadUser = {
    ...userData,
    tipe_kognitif: overrideType || userData.tipe_kognitif,
  };

  const formData = new FormData();
  formData.append("profesi", payloadUser.profesi);
  formData.append("umur", payloadUser.umur);
  formData.append("tipe_kognitif", payloadUser.tipe_kognitif);
  formData.append("pertanyaan", payloadUser.pertanyaan);
  formData.append("stage", stage);
  if (sessionId) formData.append("session_id", sessionId);

  const response = await fetch("/ask_stage", { method: "POST", body: formData });
  const data = await response.json();

  // simpan session id
  if (!sessionId) sessionId = data.session_id;

  stageDiv.innerHTML = `<h3>${data.tahap}</h3><p>${data.answer}</p>`;

  const jawabanForm = document.createElement("form");
  jawabanForm.innerHTML = `
    <label>Jawaban Anda:</label><br>
    <input type="text" name="jawaban_user" required>
    <button type="submit">Kirim Jawaban</button>
  `;
  stageDiv.appendChild(jawabanForm);

  jawabanForm.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      const jawaban_user = jawabanForm.jawaban_user.value;

      const checkFormData = new FormData();
      checkFormData.append("profesi", payloadUser.profesi);
      checkFormData.append("umur", payloadUser.umur);
      checkFormData.append("tipe_kognitif", payloadUser.tipe_kognitif);
      checkFormData.append("pertanyaan", payloadUser.pertanyaan);
      checkFormData.append("jawaban_user", jawaban_user);
      if (sessionId) checkFormData.append("session_id", sessionId);

      const res = await fetch("/check_answer", {
        method: "POST",
        body: checkFormData,
      });

      const hasil = await res.json();
      if (!sessionId) sessionId = hasil.session_id;

      const hasilDiv = document.createElement("div");
      hasilDiv.innerHTML = `
        <p><strong>Jawaban:</strong> ${hasil.correct ? "Benar" : "Salah"}</p>
        <p>${hasil.feedback}</p>
      `;
      stageDiv.appendChild(hasilDiv);

      if (hasil.correct) {
        const end = document.createElement("p");
        end.innerHTML = "✅ Jawabanmu sudah tepat. Proses dihentikan di tahap ini.";
        stageDiv.appendChild(end);
      } else {
        currentStage++;
        await handleStage(payloadUser, currentStage, mountEl, overrideType);
      }
    },
    { once: true }
  );
}
