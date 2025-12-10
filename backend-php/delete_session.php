<?php
// backend-php/delete_session.php
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

if ($user_id <= 0) {
    json_response("error", "Autentikasi gagal atau token tidak valid", [], 401); // 401 Unauthorized
}

if ($session_id <= 0) {
    json_response("error", "session_id tidak valid", [], 400);
}
// -----------------------------------------------------------------

// Hanya izinkan pengguna menghapus sesi miliknya sendiri
$stmt = $conn->prepare("DELETE FROM chat_sessions WHERE id = ? AND user_id = ?");

if (!$stmt) {
    if (DEBUG_MODE) error_log("delete_session.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query penghapusan", [], 500);
}

$stmt->bind_param("ii", $session_id, $user_id); // Gunakan $user_id dari token

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("delete_session.php execute error: " . $stmt->error);
    $stmt->close();
    json_response("error", "Gagal menghapus sesi", [], 500);
}

if ($stmt->affected_rows === 0) {
    $stmt->close();
    json_response("error", "Sesi tidak ditemukan atau bukan milik pengguna ini", [], 403); // 403 Forbidden
}

$stmt->close();
json_response("success", "Sesi berhasil dihapus");
