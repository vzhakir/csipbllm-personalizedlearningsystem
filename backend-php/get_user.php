<?php
// backend-php/get_user.php
require_once "config.php";

// --- PERUBAHAN: AMBIL USER ID HANYA DARI HEADER OTENTIKASI ---
$user_id = get_user_id_from_auth(); 

if ($user_id <= 0) {
    // Kembalikan 401 Unauthorized jika token tidak valid
    json_response("error", "Autentikasi diperlukan.", [], 401); 
}
// -----------------------------------------------------------------

$stmt = $conn->prepare("
    SELECT id, username, email, cognitive, cq1, cq2, created_at
    FROM users
    WHERE id = ?
    LIMIT 1
");
if (!$stmt) {
    if (DEBUG_MODE) error_log("get_user.php prepare error: " . $conn->error);
    json_response("error", "Gagal menyiapkan query get_user", [], 500);
}

$stmt->bind_param("i", $user_id);
$stmt->execute();
$res = $stmt->get_result();

if ($res && $row = $res->fetch_assoc()) {
    $stmt->close();
    json_response("success", "", ["user" => $row]);
}

$stmt->close();
json_response("error", "User tidak ditemukan", [], 404);
?>
