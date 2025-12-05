<?php
// backend-php/register.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    json_response("error", "Method not allowed");
}

$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data)) {
    if (DEBUG_MODE) {
        error_log("register.php JSON decode gagal. Raw: " . $raw);
    }
    json_response("error", "Body request harus JSON");
}

$username  = trim($data["username"] ?? "");
$email     = trim($data["email"] ?? "");
$password  = (string)($data["password"] ?? "");

// Profil kognitif default
$cognitive = strtolower(trim($data["cognitive"] ?? ""));
$cq1       = strtolower(trim($data["cq1"] ?? ""));
$cq2       = strtolower(trim($data["cq2"] ?? ""));

if ($username === "" || $password === "") {
    json_response("error", "Username & password wajib diisi");
}

// Cek apakah username sudah dipakai
$check = $conn->prepare("SELECT id FROM users WHERE username = ? LIMIT 1");
if (!$check) {
    if (DEBUG_MODE) error_log("register.php prepare check error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query pengecekan username");
}
$check->bind_param("s", $username);
$check->execute();
$checkRes = $check->get_result();

if ($checkRes && $checkRes->num_rows > 0) {
    $check->close();
    json_response("error", "Username sudah digunakan, silakan pilih yang lain");
}
$check->close();

// Hash password
$hashed = password_hash($password, PASSWORD_DEFAULT);

// Insert user baru
$stmt = $conn->prepare("
    INSERT INTO users (username, email, password, cognitive, cq1, cq2, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW())
");

if (!$stmt) {
    if (DEBUG_MODE) error_log("register.php prepare insert error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query register");
}

$stmt->bind_param("ssssss", $username, $email, $hashed, $cognitive, $cq1, $cq2);

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("register.php execute error: " . $stmt->error);
    $stmt->close();
    json_response("error", "Gagal registrasi user");
}

$userId = $stmt->insert_id;
$stmt->close();

json_response("success", "Registrasi berhasil", [
    "user_id"   => (int)$userId,
    "username"  => $username,
    "cognitive" => $cognitive,
    "cq1"       => $cq1,
    "cq2"       => $cq2
]);
