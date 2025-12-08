<?php
// backend-php/delete_user.php
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

if ($user_id <= 0) {
    json_response("error", "user_id tidak valid");
}

// CATATAN: Dalam sistem produksi, perlu ada token autentikasi (misalnya JWT)
// untuk memastikan pengguna yang meminta penghapusan benar-benar pemilik akun.

$stmt = $conn->prepare("DELETE FROM users WHERE id = ?");

if (!$stmt) {
    if (DEBUG_MODE) error_log("delete_user.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query penghapusan");
}

$stmt->bind_param("i", $user_id);

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("delete_user.php execute error: " . $stmt->error);
    $stmt->close();
    json_response("error", "Gagal menghapus user");
}

$stmt->close();
json_response("success", "Akun berhasil dihapus");
