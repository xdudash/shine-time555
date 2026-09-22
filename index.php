<?php
declare(strict_types=1);

$configFile = __DIR__ . '/config/supabase.php';
if (!is_file($configFile)) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Missing config/supabase.php. Upload the complete Shine Time archive again.');
}
$config = require $configFile;
$script = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/app/index.php');
$base = rtrim(dirname($script), '/');
$base = ($base === '' || $base === '/') ? '/' : $base . '/';
$build = (string)($config['release_build'] ?? 'unknown');
$publicConfig = [
    'url' => (string)($config['url'] ?? ''),
    'publishableKey' => (string)($config['publishable_key'] ?? ''),
    'functionName' => (string)($config['function_name'] ?? 'st-api'),
];
?><!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#1c3027"><meta name="robots" content="noindex"><title>Shine Time</title><link rel="stylesheet" href="assets/platform.css?v=<?= filemtime(__DIR__ . '/assets/platform.css') ?>"></head><body><div id="app"></div><script>window.ST_BASE=<?= json_encode($base,JSON_HEX_TAG|JSON_HEX_AMP) ?>;window.ST_SUPABASE=<?= json_encode($publicConfig,JSON_HEX_TAG|JSON_HEX_AMP) ?>;</script><script src="assets/platform.js?v=<?= filemtime(__DIR__ . '/assets/platform.js') ?>"></script></body></html>