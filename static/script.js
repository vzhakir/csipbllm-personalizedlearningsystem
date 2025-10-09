const form = document.getElementById("user-form");
const resultDiv = document.getElementById("result");
let sessionId = null; // simpan session id global

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  // reset tampilan
  resultDiv.innerHTML = "";

  const formData = new FormData(form);
  const baseData = {
    profesi: formData.get("profesi"),
    umur: parseInt(formData.get("umur")),
    tipe_kognitif: formData.get("tipe_kognitif"),
    pertanyaan: formData.get("pertanyaan"),
  };

  // === Tombol download histori ===
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

  // === Pilih 2 tipe random untuk pembanding ===
  const allTypes = ["visual", "auditori", "kinestetik"];
  const shuffled = allTypes.sort(() => Math.random() - 0.5);
  const [leftType, rightType] = shuffled.slice(0, 2);

  // === Grid compare ===
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

  // === Panggil bot untuk jawaban utama dan perbandingan ===
  await handleCompareAnswer(baseData, left, right, leftType, rightType);
});

// === Fungsi handle jawaban bot ===
async function handleCompareAnswer(userData, leftEl, rightEl, leftType, rightType) {
  const stageDivL = document.createElement("div");
  const stageDivR = document.createElement("div");

  stageDivL.className = "stage";
  stageDivR.className = "stage";

  stageDivL.innerHTML = `<p>⏳ Memuat jawaban...</p>`;
  stageDivR.innerHTML = `<p>⏳ Memuat jawaban...</p>`;

  leftEl.appendChild(stageDivL);
  rightEl.appendChild(stageDivR);

  // === Request ke backend ===
  const formData = new FormData();
  formData.append("profesi", userData.profesi);
  formData.append("umur", userData.umur);
  formData.append("tipe_kognitif", userData.tipe_kognitif);
  formData.append("pertanyaan", userData.pertanyaan);

  if (sessionId) {
    formData.append("session_id", sessionId);
  }

  const response = await fetch("/ask", {
    method: "POST",
    body: formData
  });

  const data = await response.json();

  if (!sessionId) {
    sessionId = data.session_id;
  }

  // === Render jawaban bot di 2 kolom ===
  stageDivL.innerHTML = `
    <div class="bot-answer">
      ${marked.parse(data.answer)}
    </div>
  `;

  stageDivR.innerHTML = `
    <div class="bot-answer">
      ${marked.parse(data.answer)}
    </div>
  `;

  // === Form untuk jawaban user ===
  const jawabanForm = document.createElement("form");
  jawabanForm.className = "jawaban-form";

  jawabanForm.innerHTML = `
    <label for="jawaban_user">Jawaban Anda:</label><br>
    <textarea 
      name="jawaban_user" 
      rows="4" 
      placeholder="Tulis jawabanmu di sini... (bisa markdown atau kode)" 
      required></textarea>
    <br>
    <button type="submit">Kirim Jawaban</button>
  `;

  // render hanya sekali di bawah grid
  resultDiv.appendChild(jawabanForm);

  jawabanForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const jawaban_user = jawabanForm.jawaban_user.value;

    const checkFormData = new FormData();
    checkFormData.append("profesi", userData.profesi);
    checkFormData.append("umur", userData.umur);
    checkFormData.append("tipe_kognitif", userData.tipe_kognitif);
    checkFormData.append("pertanyaan", userData.pertanyaan);
    checkFormData.append("jawaban_user", jawaban_user);

    if (sessionId) {
      checkFormData.append("session_id", sessionId);
    }

    const res = await fetch("/check_answer", {
      method: "POST",
      body: checkFormData
    });

    const hasil = await res.json();

    if (!sessionId) {
      sessionId = hasil.session_id;
    }

    const hasilDiv = document.createElement("div");
    hasilDiv.className = "jawaban-feedback";

    hasilDiv.innerHTML = `
      <h4>Jawaban Anda:</h4>
      <div class="user-answer">
        ${marked.parse(jawaban_user)}
      </div>
      <h4>Evaluasi:</h4>
      <div class="bot-feedback">
        ${marked.parse(hasil.feedback)}
      </div>
      <p><strong>Status:</strong> ${hasil.correct ? "✅ Benar" : "❌ Salah"}</p>
    `;

    resultDiv.appendChild(hasilDiv);

    if (hasil.correct) {
      const end = document.createElement("p");
      end.innerHTML = "✅ Jawabanmu sudah tepat. Proses dihentikan di sini.";

      resultDiv.appendChild(end);
    }
  }, { once: true });
}