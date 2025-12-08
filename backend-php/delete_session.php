<?php
// backend-php/delete_session.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    json_response("error", "Method not allowed");
}

// Baca body JSON
$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data)) {
    json_response("error", "Body request harus JSON");
}

$user_id = (int)($data["user_id"] ?? 0);
$session_id = (int)($data["session_id"] ?? 0);

if ($user_id <= 0 || $session_id <= 0) {
    json_response("error", "user_id dan session_id tidak valid");
}

// Hanya izinkan pengguna menghapus sesi miliknya sendiri
$stmt = $conn->prepare("DELETE FROM chat_sessions WHERE id = ? AND user_id = ?");

if (!$stmt) {
    if (DEBUG_MODE) error_log("delete_session.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query penghapusan");
}

$stmt->bind_param("ii", $session_id, $user_id);

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("delete_session.php execute error: " . $stmt->error);
    $stmt->close();
    json_response("error", "Gagal menghapus sesi");
}

if ($stmt->affected_rows === 0) {
    $stmt->close();
    json_response("error", "Sesi tidak ditemukan atau bukan milik pengguna ini");
}

$stmt->close();
json_response("success", "Sesi berhasil dihapus");
?>