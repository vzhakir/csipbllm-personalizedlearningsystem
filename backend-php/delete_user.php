<?php
// backend-php/delete_user.php
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
// Kita mengabaikan user_id yang dikirim di body, hanya menggunakan ID dari token.
$user_id = get_user_id_from_auth(); 

if ($user_id <= 0) {
    json_response("error", "Autentikasi gagal atau token tidak valid", [], 401); // 401 Unauthorized
}
// -----------------------------------------------------------------

$stmt = $conn->prepare("DELETE FROM users WHERE id = ?");

if (!$stmt) {
    if (DEBUG_MODE) error_log("delete_user.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query penghapusan", [], 500);
}

$stmt->bind_param("i", $user_id);

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("delete_user.php execute error: " . $stmt->error);
    $stmt->close();
    json_response("error", "Gagal menghapus user", [], 500);
}

$stmt->close();
json_response("success", "Akun berhasil dihapus");
