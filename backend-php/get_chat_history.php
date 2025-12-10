<?php
// backend-php/get_chat_history.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    json_response("error", "Method not allowed", [], 405);
}

$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data)) {
    json_response("error", "Body request tidak valid", [], 400);
}

// --- PERUBAHAN KRITIS: AMBIL USER ID DARI HEADER OTENTIKASI ---
$user_id = get_user_id_from_auth(); 

if ($user_id <= 0) {
    json_response("error", "Autentikasi gagal atau token tidak valid", [], 401);
}
// -----------------------------------------------------------------

$session_id = (int)($data["session_id"] ?? 0);
$format = (string)($data["format"] ?? "json"); 
$limit = (int)($data["limit"] ?? 20); 

// 1. Ambil Semua Sesi untuk Sidebar
if ($session_id === 0) {
    // Ambil sesi terbaru (untuk sidebar)
    $stmt = $conn->prepare("
        SELECT id, title, start_time
        FROM chat_sessions
        WHERE user_id = ?
        ORDER BY start_time DESC
        LIMIT ?
    ");
    
    if (!$stmt) {
        if (DEBUG_MODE) error_log("get_sessions prepare error: " . $conn->error);
        json_response("error", "Gagal menyiapkan query sesi", [], 500);
    }
    
    $stmt->bind_param("ii", $user_id, $limit);
    $stmt->execute();
    $result = $stmt->get_result();
    
    $sessions = [];
    while ($row = $result->fetch_assoc()) {
        $sessions[] = $row;
    }
    $stmt->close();
    
    json_response("success", "", ["sessions" => $sessions]);
}

// 2. Ambil Semua Giliran Percakapan dalam Satu Sesi
if ($session_id > 0) {
    // Tambahkan subquery EXISTS untuk memastikan sesi milik user yang terotentikasi
    $stmt = $conn->prepare("
        SELECT * FROM conversation_turns
        WHERE session_id = ?
        AND EXISTS (SELECT 1 FROM chat_sessions WHERE id = ? AND user_id = ?) 
        ORDER BY log_time ASC
    ");
    
    if (!$stmt) {
        if (DEBUG_MODE) error_log("get_turns prepare error: " . $conn->error);
        json_response("error", "Gagal menyiapkan query turns", [], 500);
    }
    
    $stmt->bind_param("iii", $session_id, $session_id, $user_id); 
    $stmt->execute();
    $result = $stmt->get_result();
    
    $turns = [];
    while ($row = $result->fetch_assoc()) {
        $turns[] = $row;
    }
    $stmt->close();
    
    if ($format === "txt") {
        // Logika sederhana untuk format TXT
        $text_data = "";
        foreach ($turns as $i => $turn) {
            $text_data .= "--- TURN #".($i + 1)." ({$turn['turn_type']}) ---\n";
            $text_data .= "Siswa: {$turn['user_message']}\n";
            $text_data .= "Tutor Utama:\n{$turn['reply_main']}\n";
            $text_data .= "---------------------------------------------------\n";
        }
        json_response("success", "", ["data" => $text_data]);
    }

    json_response("success", "", ["turns" => $turns]);
}
?>
