<?php
// backend-php/change_password.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    json_response("error", "Method not allowed", [], 405);
}

$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data)) {
    json_response("error", "Body request harus JSON", [], 400);
}

// --- PERUBAHAN KRITIS: AMBIL USER ID DARI HEADER OTENTIKASI ---
$user_id = get_user_id_from_auth(); 

if ($user_id <= 0) {
    json_response("error", "Autentikasi gagal atau token tidak valid", [], 401);
}
// -----------------------------------------------------------------

$old_password = (string)($data["old_password"] ?? "");
$new_password = (string)($data["new_password"] ?? "");

if ($old_password === "" || $new_password === "") {
    json_response("error", "Password lama dan password baru wajib diisi.", [], 400);
}

if (strlen($new_password) < 6) {
    json_response("error", "Password baru minimal 6 karakter.", [], 400);
}

// 1. Ambil password hash lama
$stmt = $conn->prepare("SELECT password FROM users WHERE id = ? LIMIT 1");
if (!$stmt) {
    if (DEBUG_MODE) error_log("change_password.php prepare error (select): " . $conn->error);
    json_response("error", "Gagal menyiapkan query.", [], 500);
}
$stmt->bind_param("i", $user_id);
$stmt->execute();
$result = $stmt->get_result();

if (!$row = $result->fetch_assoc()) {
    $stmt->close();
    json_response("error", "User tidak ditemukan.", [], 404);
}
$stmt->close();

$hashedPassword = $row["password"] ?? "";

// 2. Verifikasi password lama
if (!password_verify($old_password, $hashedPassword)) {
    json_response("error", "Password lama salah.", [], 401);
}

// 3. Hash dan update password baru
$new_hashed = password_hash($new_password, PASSWORD_DEFAULT);

$stmt = $conn->prepare("UPDATE users SET password = ? WHERE id = ?");

if (!$stmt) {
    if (DEBUG_MODE) error_log("change_password.php prepare error (update): " . $conn->error);
    json_response("error", "Gagal menyiapkan query update.", [], 500);
}
$stmt->bind_param("si", $new_hashed, $user_id);

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("change_password.php execute error: " . $stmt->error);
    $stmt->close();
    json_response("error", "Gagal mengganti password.", [], 500);
}

$stmt->close();
json_response("success", "Password berhasil diubah.");
?>
