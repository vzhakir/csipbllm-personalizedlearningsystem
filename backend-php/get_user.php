<?php
// backend-php/get_user.php
require_once "config.php";

// Bisa ambil dari GET atau body JSON
$user_id = 0;

if (isset($_GET["user_id"])) {
    $user_id = (int)$_GET["user_id"];
} else {
    $raw  = file_get_contents("php://input");
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        if (DEBUG_MODE) {
            error_log("get_user.php JSON decode gagal. Raw: " . $raw);
        }
    } else {
        $user_id = (int)($data["user_id"] ?? 0);
    }
}

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
    if (DEBUG_MODE) error_log("get_user.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query get_user");
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
