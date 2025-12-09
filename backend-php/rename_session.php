<?php
// backend-php/rename_session.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    json_response("error", "Method not allowed", [], 405);
}

// Baca body JSON
$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data)) {
    json_response("error", "Body request harus JSON", [], 400);
}

// --- PERUBAHAN KRITIS: AMBIL USER ID DARI HEADER OTENTIKASI ---
$user_id = get_user_id_from_auth(); 
$session_id = (int)($data["session_id"] ?? 0);
$new_title = trim((string)($data["new_title"] ?? ""));

if ($user_id <= 0) {
    json_response("error", "Autentikasi gagal atau token tidak valid", [], 401); // 401 Unauthorized
}
// -----------------------------------------------------------------

if ($session_id <= 0 || $new_title === "") {
    json_response("error", "ID sesi, dan judul baru wajib diisi.", [], 400);
}

// Batasi panjang judul
if (strlen($new_title) > 255) {
    $new_title = substr($new_title, 0, 255);
}

// Hanya izinkan pengguna mengubah sesi miliknya sendiri.
$stmt = $conn->prepare("UPDATE chat_sessions SET title = ? WHERE id = ? AND user_id = ?");

if (!$stmt) {
    if (DEBUG_MODE) error_log("rename_session.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query update", [], 500);
}

$stmt->bind_param("sii", $new_title, $session_id, $user_id); // Gunakan $user_id dari token

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("rename_session.php execute error: " . $stmt->error);
    $stmt->close();
    json_response("error", "Gagal mengganti nama sesi", [], 500);
}

if ($stmt->affected_rows === 0) {
    $stmt->close();
    json_response("error", "Sesi tidak ditemukan atau tidak ada perubahan nama.", [], 403); 
}

$stmt->close();
json_response("success", "Nama sesi berhasil diubah", ["new_title" => $new_title]);
