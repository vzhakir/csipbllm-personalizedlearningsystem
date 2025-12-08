<?php
// backend-php/session_management.php
require_once "config.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    json_response("error", "Method not allowed");
}

// Menganalisis action dari body JSON
$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!is_array($data) || !isset($data["action"])) {
    json_response("error", "Body request tidak valid");
}

$action = $data["action"];

if ($action === "start_session") {
    // ACTION 1: MEMULAI SESI BARU
    $user_id = (int)($data["user_id"] ?? 0);
    $title = (string)($data["title"] ?? "Sesi Obrolan Baru");
    $cognitive = (string)($data["cognitive"] ?? "par");
    $cq1 = (string)($data["cq1"] ?? "t");
    $cq2 = (string)($data["cq2"] ?? "a");
    
    if ($user_id <= 0) {
        json_response("error", "user_id wajib diisi untuk memulai sesi");
    }

    $stmt = $conn->prepare("
        INSERT INTO chat_sessions (user_id, title, cognitive_start, cq1_start, cq2_start, start_time)
        VALUES (?, ?, ?, ?, ?, NOW())
    ");

    if (!$stmt) {
        if (DEBUG_MODE) error_log("start_session prepare error: " . $conn->error);
        json_response("error", "Gagal menyiapkan query start session");
    }

    $stmt->bind_param("issss", $user_id, $title, $cognitive, $cq1, $cq2);

    if (!$stmt->execute()) {
        if (DEBUG_MODE) error_log("start_session execute error: " . $stmt->error);
        $stmt->close();
        json_response("error", "Gagal memulai sesi baru");
    }

    $sessionId = $stmt->insert_id;
    $stmt->close();

    json_response("success", "Sesi berhasil dimulai", ["session_id" => (int)$sessionId]);

} elseif ($action === "log_turn") {
    // ACTION 2: MENCATAT GILIRAN PERCAKAPAN
    $session_id = (int)($data["session_id"] ?? 0);
    $turn_type = (string)($data["turn_type"] ?? "chat");
    // Ambil semua data logging dari FastAPI
    $user_message = (string)($data["user_message"] ?? "");
    $reply_main = (string)($data["reply_main"] ?? "");
    $reply_compare = (string)($data["reply_compare"] ?? "");
    $followup_question = (string)($data["followup_question"] ?? "");
    $cognitive_main = (string)($data["cognitive_main"] ?? "par");
    $cq1_main = (string)($data["cq1_main"] ?? "t");
    $cq2_main = (string)($data["cq2_main"] ?? "a");
    $prompt_style_main = (string)($data["prompt_style_main"] ?? "zero_shot");
    $is_correct = isset($data["is_correct"]) ? (int)$data["is_correct"] : NULL;
    $wrong_attempts = (int)($data["wrong_attempts"] ?? 0);
    $latency_main_s = (float)($data["latency_main_s"] ?? 0.0);
    $used_rag = (int)($data["used_rag"] ?? 0);
    $rag_mode = (string)($data["rag_mode"] ?? "");

    if ($session_id <= 0 || $user_message === "") {
        json_response("error", "session_id dan user_message wajib diisi untuk log turn");
    }

    // Perhatikan urutan dan tipe data parameter (s: string, i: integer, d: double)
    $type_def = "isssssssssisdis"; 

    $stmt = $conn->prepare("
        INSERT INTO conversation_turns 
        (session_id, turn_type, user_message, reply_main, reply_compare, followup_question, 
         cognitive_main, cq1_main, cq2_main, prompt_style_main, 
         is_correct, wrong_attempts, latency_main_s, used_rag, rag_mode, log_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ");
    
    if (!$stmt) {
        if (DEBUG_MODE) error_log("log_turn prepare error: " . $conn->error);
        json_response("error", "Gagal menyiapkan query log turn");
    }

    $stmt->bind_param(
        $type_def, 
        $session_id, $turn_type, $user_message, $reply_main, $reply_compare, $followup_question,
        $cognitive_main, $cq1_main, $cq2_main, $prompt_style_main,
        $is_correct, $wrong_attempts, $latency_main_s, $used_rag, $rag_mode
    );

    if (!$stmt->execute()) {
        if (DEBUG_MODE) error_log("log_turn execute error: " . $stmt->error);
        $stmt->close();
        json_response("error", "Gagal mencatat giliran percakapan");
    }

    $stmt->close();
    json_response("success", "Giliran percakapan berhasil dicatat");

} else {
    json_response("error", "Action tidak dikenali");
}
?>