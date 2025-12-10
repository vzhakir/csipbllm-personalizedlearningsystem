<?php
// backend-php/config.php

declare(strict_types=1);

// ====== MODE DEBUG (true = tampilkan info tambahan di JSON & error_log) ======
define("DEBUG_MODE", true);

// ====== KEAMANAN KRITIS: GANTI INI! ======
define("AUTH_SECRET", getenv('AUTH_SECRET') ?: "secret_key_yang_sangat_panjang_dan_rumit_ganti_ini"); 
// BARU: Token berlaku 2 jam (7200 detik)
define("TOKEN_EXPIRY_SECONDS", 7200); 

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

// ====== KONFIG DB (Diambil dari Environment Variable atau nilai default) ======
$DB_HOST = getenv('DB_HOST') ?: "localhost";
$DB_USER = getenv('DB_USER') ?: "__________";
$DB_PASS = getenv('DB_PASS') ?: "__________";
$DB_NAME = getenv('DB_NAME') ?: "llmchatbot";

// ====== KONEKSI DB ======
$conn = new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME); 
if ($conn->connect_error) {
    error_log("DB connection failed: " . $conn->connect_error);
    http_response_code(500);

    $resp = [
        "status"  => "error",
        "message" => "Internal Server Error: DB connection failed"
    ];
    if (DEBUG_MODE) {
        $resp["debug"] = $conn->connect_error;
    }
    echo json_encode($resp);
    exit;
}

// ====== HELPER: RESPON JSON CEPAT (Dengan HTTP Status Code) ======
function json_response(string $status, string $message = "", array $extra = [], int $httpCode = 200): void {
    global $conn;
    if ($conn) $conn->close(); // Tutup koneksi DB saat merespons
    
    http_response_code($httpCode); // Set status code
    $base = ["status" => $status];
    if ($message !== "") {
        $base["message"] = $message;
    }
    echo json_encode(array_merge($base, $extra));
    exit;
}

// ====== HELPER: OTENTIKASI (Diperbarui untuk Expiration) ======
function get_user_id_from_auth(): int {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
        $token = $matches[1];
        
        // Logika token sederhana: user_id.expiry_timestamp.signature
        $parts = explode('.', $token);
        if (count($parts) === 3) {
            $userId = (int)$parts[0];
            $expiryTime = (int)$parts[1]; // BARU: Expiry Timestamp
            
            // 1. Cek Expiration
            if (time() > $expiryTime) {
                // Token Expired
                return 0;
            }
            
            // 2. Verifikasi signature (HMAC)
            $data = "{$parts[0]}.{$parts[1]}";
            $expectedSignature = hash_hmac('sha256', $data, AUTH_SECRET);
            if ($expectedSignature === $parts[2] && $userId > 0) {
                return $userId;
            }
        }
    }
    return 0;
}

function generate_dummy_token(int $userId): string {
    // BARU: Hitung waktu kadaluarsa
    $expiryTime = time() + TOKEN_EXPIRY_SECONDS;
    
    // Logika token sederhana: user_id.expiry_timestamp.signature
    $data = "{$userId}.{$expiryTime}";
    $signature = hash_hmac('sha256', $data, AUTH_SECRET);
    return "{$userId}.{$expiryTime}.{$signature}"; // Token berisi expiry
}
?>
