<?php
// backend-php/update_profile.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    json_response("error", "Method not allowed", [], 405);
}

$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data)) {
    json_response("error", "Body request harus JSON", [], 400);
}

$user_id = (int)($data["user_id"] ?? 0);
if ($user_id <= 0) {
    json_response("error", "user_id tidak valid atau Autentikasi gagal", [], 401);
}

// Data yang diizinkan untuk diupdate
$email_to_db = empty($email) ? NULL : $email;
$cognitive = strtolower(trim($data["cognitive"] ?? ""));
$cq1       = strtolower(trim($data["cq1"] ?? ""));
$cq2       = strtolower(trim($data["cq2"] ?? ""));

// Tambahkan validasi email di sini jika perlu
if (!empty($email) && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response("error", "Format email tidak valid", [], 400);
}

// --- PENINGKATAN: VALIDASI PANJANG STRING ---
if (!empty($email) && strlen($email) > 100) {
    json_response("error", "Email maksimal 100 karakter.", [], 400);
}
// ---------------------------------------------


$stmt = $conn->prepare("
    UPDATE users SET email = ?, cognitive = ?, cq1 = ?, cq2 = ?
    WHERE id = ?
");

if (!$stmt) {
    if (DEBUG_MODE) error_log("update_profile.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query update", [], 500);
}

$stmt->bind_param("ssssi", $email, $cognitive, $cq1, $cq2, $user_id);

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("update_profile.php execute error: " . $stmt->error);
    // Catatan: Jika Anda ingin menangani error duplicate entry (misalnya email sudah dipakai):
    // if ($conn->errno === 1062) { json_response("error", "Email sudah digunakan.", [], 409); }
    $stmt->close();
    json_response("error", "Gagal mengupdate profil user", [], 500);
}

$stmt->close();
json_response("success", "Profil berhasil diupdate", [
    "user_id"   => $user_id,
    "email"     => $email,
    "cognitive" => $cognitive,
    "cq1"       => $cq1,
    "cq2"       => $cq2
]);
