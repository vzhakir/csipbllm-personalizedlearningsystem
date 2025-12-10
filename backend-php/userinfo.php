<?php
// backend-php/userinfo.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    json_response("error", "Method not allowed");
}

$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data)) {
    if (DEBUG_MODE) {
        error_log("userinfo.php JSON decode gagal. Raw: " . $raw);
    }
    json_response("error", "Body request harus JSON");
}

$user_id = (int)($data["user_id"] ?? 0);
if ($user_id <= 0) {
    json_response("error", "user_id tidak valid");
}

$stmt = $conn->prepare("
    SELECT id, username, email, cognitive, cq1, cq2, created_at
    FROM users
    WHERE id = ?
    LIMIT 1
");
if (!$stmt) {
    if (DEBUG_MODE) error_log("userinfo.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query userinfo");
}

$stmt->bind_param("i", $user_id);
$stmt->execute();
$res = $stmt->get_result();

if ($res && $row = $res->fetch_assoc()) {
    $stmt->close();
    json_response("success", "", ["user" => $row]);
}

$stmt->close();
json_response("error", "User tidak ditemukan");
