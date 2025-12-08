<?php
// backend-php/rename_session.php
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
$new_title = trim((string)($data["new_title"] ?? ""));

if ($user_id <= 0 || $session_id <= 0 || $new_title === "") {
    json_response("error", "ID pengguna, ID sesi, dan judul baru wajib diisi.");
}

// Batasi panjang judul
if (strlen($new_title) > 255) {
    $new_title = substr($new_title, 0, 255);
}

// Hanya izinkan pengguna mengubah sesi miliknya sendiri.
$stmt = $conn->prepare("UPDATE chat_sessions SET title = ? WHERE id = ? AND user_id = ?");

if (!$stmt) {
    if (DEBUG_MODE) error_log("rename_session.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query update");
}

$stmt->bind_param("sii", $new_title, $session_id, $user_id);

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("rename_session.php execute error: " . $stmt->error);
    $stmt->close();
    json_response("error", "Gagal mengganti nama sesi");
}

if ($stmt->affected_rows === 0) {
    $stmt->close();
    json_response("error", "Sesi tidak ditemukan atau tidak ada perubahan nama.");
}

$stmt->close();
json_response("success", "Nama sesi berhasil diubah", ["new_title" => $new_title]);
?>