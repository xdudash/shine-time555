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
?><!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#111827">
  <meta name="robots" content="noindex">
  <title>Shine Time Operations</title>
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="stylesheet" href="assets/styles.css?v=<?= rawurlencode((string)filemtime(__DIR__ . '/assets/styles.css')) ?>">
  <link rel="stylesheet" href="assets/ui-system.css?v=<?= rawurlencode((string)filemtime(__DIR__ . '/assets/ui-system.css')) ?>">
  <link rel="stylesheet" href="assets/mobile-ui.css?v=<?= rawurlencode((string)filemtime(__DIR__ . '/assets/mobile-ui.css')) ?>">
  <link rel="stylesheet" href="assets/job-lifecycle.css?v=<?= rawurlencode((string)filemtime(__DIR__ . '/assets/job-lifecycle.css')) ?>">
</head>
<body>
  <div id="app"></div>
  <div id="modal-root"></div>
  <div id="toast-root"></div>
  <script>
    window.ST_BASE = <?= json_encode($base, JSON_UNESCAPED_SLASHES) ?>;
    window.ST_BUILD = <?= json_encode($build, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;
    window.ST_SUPABASE = <?= json_encode($publicConfig, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;
  </script>
  <script src="assets/i18n.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/i18n.js'), 0, 16) ?>"></script>
  <script src="assets/supabase-client.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/supabase-client.js'), 0, 16) ?>"></script>
  <script src="assets/operations-ui-core.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/operations-ui-core.js'), 0, 16) ?>"></script>
  <script src="assets/live-updates.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/live-updates.js'), 0, 16) ?>"></script>
  <script src="assets/app.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/app.js'), 0, 16) ?>"></script>
  <script src="assets/money.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/money.js'), 0, 16) ?>"></script>
  <script src="assets/operations-extension.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/operations-extension.js'), 0, 16) ?>"></script>
  <script src="assets/operations-validation.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/operations-validation.js'), 0, 16) ?>"></script>
  <script src="assets/monitoring-extension.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/monitoring-extension.js'), 0, 16) ?>"></script>
  <script src="assets/export.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/export.js'), 0, 16) ?>"></script>
  <script src="assets/table-tools.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/table-tools.js'), 0, 16) ?>"></script>
  <script src="assets/pwa-actions.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/pwa-actions.js'), 0, 16) ?>"></script>
  <script src="assets/cleaner-gps-enforcement.js?v=<?= substr(hash_file('sha256', __DIR__ . '/assets/cleaner-gps-enforcement.js'), 0, 16) ?>"></script>
  <script>bootstrap();</script>
</body>
</html>
