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
  <script src="assets/i18n.js?v=<?= rawurlencode((string)filemtime(__DIR__ . '/assets/i18n.js')) ?>"></script>
  <script src="assets/supabase-client.js?v=<?= rawurlencode((string)filemtime(__DIR__ . '/assets/supabase-client.js')) ?>"></script>
  <script src="assets/operations-ui-core.js?v=<?= rawurlencode((string)filemtime(__DIR__ . '/assets/operations-ui-core.js')) ?>"></script>
  <script src="assets/live-updates.js"></script>
  <script src="assets/app.js?v=<?= rawurlencode((string)filemtime(__DIR__ . '/assets/app.js')) ?>"></script>
  <script src="assets/money.js"></script>
  <script src="assets/operations-extension.js"></script>
  <script src="assets/operations-validation.js"></script>
  <script src="assets/monitoring-extension.js"></script>
  <script src="assets/export.js"></script>
  <script src="assets/operations-automation.js"></script>
  <script src="assets/operations-command-center.js"></script>
  <script src="assets/operations-dashboard.js"></script>
  <script src="assets/ops-dashboard-widgets.js"></script>
  <script src="assets/ops-charts.js"></script>
  <script src="assets/shift-planner.js"></script>
  <script src="assets/shift-board.js"></script>
  <script src="assets/auto-assignment.js"></script>
  <script src="assets/rescue-automation.js"></script>
  <script src="assets/bulk-operations.js"></script>
  <script src="assets/dispatch-engine.js"></script>
  <script src="assets/dispatch-workflow.js"></script>
  <script src="assets/dispatch-planner.js"></script>
  <script src="assets/dispatch-recommendations.js"></script>
  <script src="assets/performance-engine.js"></script>
  <script src="assets/operations-brain.js"></script>
  <script src="assets/command-center-live.js"></script>
  <script src="assets/notifications-center.js"></script>
  <script src="assets/notifications-tools.js"></script>
  <script src="assets/payout-engine.js"></script>
  <script src="assets/payout-queue.js"></script>
  <script src="assets/finance-tools.js"></script>
  <script src="assets/schedule-tools.js"></script>
  <script src="assets/form-tools.js"></script>
  <script src="assets/table-tools.js"></script>
  <script src="assets/activity-log.js"></script>
  <script src="assets/pwa-actions.js"></script>
  <script src="assets/operations-command-surface.js"></script>
  <script src="assets/dispatch-console.js"></script>
  <script src="assets/job-lifecycle-console.js"></script>
  <script src="assets/cleaner-gps-enforcement.js"></script>
  <script>bootstrap();</script>
</body>
</html>
