<?php
// backend-php/get_chat_history.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    json_response("error", "Method not allowed");
}

$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data) || !isset($data["user_id"])) {
    json_response("error", "user_id wajib diisi");
}

$user_id = (int)($data["user_id"] ?? 0);
$session_id = (int)($data["session_id"] ?? 0);
$format = (string)($data["format"] ?? "json"); 
$limit = (int)($data["limit"] ?? 20); 

if ($user_id <= 0) {
    json_response("error", "user_id tidak valid");
}

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
        json_response("error", "Gagal menyiapkan query sesi");
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
    $stmt = $conn->prepare("
        SELECT * FROM conversation_turns
        WHERE session_id = ?
        ORDER BY log_time ASC
    ");
    
    if (!$stmt) {
        if (DEBUG_MODE) error_log("get_turns prepare error: " . $conn->error);
        json_response("error", "Gagal menyiapkan query turns");
    }
    
    $stmt->bind_param("i", $session_id);
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