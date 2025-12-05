<?php
// backend-php/login.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    json_response("error", "Method not allowed");
}

// Baca body JSON
$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data)) {
    if (DEBUG_MODE) {
        error_log("login.php JSON decode gagal. Raw: " . $raw);
    }
    json_response("error", "Body request harus JSON");
}

$username = trim($data["username"] ?? "");
$password = (string)($data["password"] ?? "");

if ($username === "" || $password === "") {
    json_response("error", "Username & password wajib diisi");
}

$stmt = $conn->prepare("
    SELECT id, username, password, cognitive, cq1, cq2
    FROM users
    WHERE username = ?
    LIMIT 1
");

if (!$stmt) {
    if (DEBUG_MODE) error_log("login.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query login");
}

$stmt->bind_param("s", $username);
$stmt->execute();
$result = $stmt->get_result();

if (!$result || $result->num_rows !== 1) {
    if (DEBUG_MODE && !$result) {
        error_log("login.php execute/get_result error: " . $conn->error);
    }
    json_response("error", "Username / password salah");
}

$row = $result->fetch_assoc();
$stmt->close();

$hashedPassword = $row["password"] ?? "";

// Verifikasi password (pastikan di DB pakai password_hash())
if (!password_verify($password, $hashedPassword)) {
    json_response("error", "Username / password salah");
}

// Token dummy (tidak disimpan di DB, hanya contoh)
$token = bin2hex(random_bytes(32));

json_response("success", "Login berhasil", [
    "user_id"   => (int)$row["id"],
    "username"  => $row["username"],
    "token"     => $token,
    "cognitive" => $row["cognitive"] ?? "par",
    "cq1"       => $row["cq1"] ?? "t",
    "cq2"       => $row["cq2"] ?? "a"
]);
