<?php
// backend-php/logout.php
require_once "config.php";

// Di sini kita tidak pakai DB, tapi config dipakai untuk CORS + helper JSON.
// Menggunakan status code 200 secara eksplisit.
json_response("success", "Logout berhasil", [], 200);
?>
