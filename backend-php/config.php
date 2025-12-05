<?php
// backend-php/config.php

declare(strict_types=1);

// ====== MODE DEBUG (true = tampilkan info tambahan di JSON & error_log) ======
define("DEBUG_MODE", true);

// ====== HEADER UMUM (JSON + CORS) ======
header("Content-Type: application/json; charset=utf-8");
header("Access-Control-Allow-Origin: http://127.0.0.1:8000"); // ganti jika perlu
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Preflight CORS (OPTIONS) → cukup balik 204 kosong
if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    http_response_code(204);
    exit;
}

// ====== KONFIG DB ======
$DB_HOST = "localhost";
$DB_USER = "##########";
$DB_PASS = "############";
$DB_NAME = "llmchatbot";

// ====== KONEKSI DB ======
$conn = @new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);
if ($conn->connect_error) {
    error_log("DB connection failed: " . $conn->connect_error);
    http_response_code(500);

    $resp = [
        "status"  => "error",
        "message" => "DB connection failed"
    ];
    if (DEBUG_MODE) {
        $resp["debug"] = $conn->connect_error;
    }
    echo json_encode($resp);
    exit;
}

// ====== HELPER: RESPON JSON CEPAT ======
function json_response(string $status, string $message = "", array $extra = []): void {
    $base = ["status" => $status];
    if ($message !== "") {
        $base["message"] = $message;
    }
    echo json_encode(array_merge($base, $extra));
    exit;
}
