<?php
// backend-php/delete_all_chats.php
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

// Hapus semua sesi obrolan yang dimiliki oleh user_id ini.
$stmt = $conn->prepare("DELETE FROM chat_sessions WHERE user_id = ?");

if (!$stmt) {
    if (DEBUG_MODE) error_log("delete_all_chats.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query penghapusan massal");
}

$stmt->bind_param("i", $user_id);

if (!$stmt->execute()) {
    if (DEBUG_MODE) error_log("delete_all_chats.php execute error: " . $stmt->error);
    $stmt->close();
    json_response("error", "Gagal menghapus semua chat");
}

$count = $stmt->affected_rows;
$stmt->close();
json_response("success", "Semua chat ({$count} sesi) berhasil dihapus");
?>