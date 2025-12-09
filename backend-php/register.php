<?php
// backend-php/register.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    json_response("error", "Method not allowed", [], 405);
}

$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data)) {
    if (DEBUG_MODE) {
        error_log("register.php JSON decode gagal. Raw: " . $raw);
    }
    json_response("error", "Body request harus JSON", [], 400);
}
// ... (code for input extraction and validation)
$username  = trim($data["username"] ?? "");
$email     = trim($data["email"] ?? "");
$password  = (string)($data["password"] ?? "");
// ... (code for cognitive profile setup)

if ($username === "" || $password === "") {
    json_response("error", "Username & password wajib diisi", [], 400);
}

// ... (code for password/email validation and username check)

// Hash password
$hashed = password_hash($password, PASSWORD_DEFAULT);

// Insert user baru
$stmt = $conn->prepare("
    INSERT INTO users (username, email, password, cognitive, cq1, cq2, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW())
");

if (!$stmt) {
    if (DEBUG_MODE) error_log("register.php prepare insert error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query register", [], 500);
}

$stmt->bind_param("ssssss", $username, $email, $hashed, $cognitive, $cq1, $cq2);

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("register.php execute error: " . $stmt->error);
    $stmt->close();
    json_response("error", "Gagal registrasi user", [], 500);
}

$userId = $stmt->insert_id;
$stmt->close();

// --- PERUBAHAN: GENERATE TOKEN BARU UNTUK PENGGUNA BARU ---
$token = generate_dummy_token($userId);
// -----------------------------------------------------------

json_response("success", "Registrasi berhasil", [
    "user_id"   => (int)$userId,
    "username"  => $username,
    "cognitive" => $cognitive,
    "cq1"       => $cq1,
    "cq2"       => $cq2,
    "token"     => $token // <-- KEMBALIKAN TOKEN
], 201);
