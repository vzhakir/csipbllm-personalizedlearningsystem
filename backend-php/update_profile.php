<?php
// backend-php/update_profile.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    json_response("error", "Method not allowed");
}

$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data)) {
    json_response("error", "Body request harus JSON");
}

$user_id = (int)($data["user_id"] ?? 0);
if ($user_id <= 0) {
    json_response("error", "user_id tidak valid");
}

// Data yang diizinkan untuk diupdate
$email     = trim($data["email"] ?? "");
$cognitive = strtolower(trim($data["cognitive"] ?? ""));
$cq1       = strtolower(trim($data["cq1"] ?? ""));
$cq2       = strtolower(trim($data["cq2"] ?? ""));

if (empty($email) || empty($cognitive) || empty($cq1) || empty($cq2)) {
    json_response("error", "Semua field profil wajib diisi untuk update");
}

// Tambahkan validasi email di sini jika perlu

$stmt = $conn->prepare("
    UPDATE users SET email = ?, cognitive = ?, cq1 = ?, cq2 = ?
    WHERE id = ?
");

if (!$stmt) {
    if (DEBUG_MODE) error_log("update_profile.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query update");
}

$stmt->bind_param("ssssi", $email, $cognitive, $cq1, $cq2, $user_id);

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("update_profile.php execute error: " . $stmt->error);
    $stmt->close();
    json_response("error", "Gagal mengupdate profil user");
}

$stmt->close();
json_response("success", "Profil berhasil diupdate", [
    "user_id"   => $user_id,
    "email"     => $email,
    "cognitive" => $cognitive,
    "cq1"       => $cq1,
    "cq2"       => $cq2
]);