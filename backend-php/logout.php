<?php
// backend-php/logout.php
require_once "config.php";

// Di sini kita tidak pakai DB, tapi config dipakai untuk CORS + helper JSON.
json_response("success", "Logout berhasil");
