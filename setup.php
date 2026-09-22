<?php
declare(strict_types=1);
$config = require __DIR__ . '/config/supabase.php';
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
  <title>Shine Time — initial setup</title>
  <link rel="stylesheet" href="assets/styles.css?v=<?= rawurlencode((string)filemtime(__DIR__ . '/assets/styles.css')) ?>">
</head>
<body>
  <main class="login-page">
    <section class="login-hero"><div><div class="brand-mark">ST</div><h1>Первичная настройка</h1><p>Создайте единственного первого администратора Shine Time. После создания этот путь автоматически блокируется.</p></div></section>
    <section class="login-box-wrap"><div class="login-box">
      <h2>Administrator</h2>
      <form id="setup-form">
        <div class="field"><label>Full name</label><input class="input" name="fullName" autocomplete="name" required></div>
        <div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label>Phone</label><input class="input" name="phone" autocomplete="tel"></div>
        <div class="field"><label>Password</label><input class="input" name="password" type="password" minlength="12" autocomplete="new-password" required></div>
        <div class="field"><label>Language</label><select class="select" name="language"><option value="ru">Русский</option><option value="sk">Slovenčina</option><option value="uk">Українська</option><option value="en">English</option></select></div>
        <button class="btn primary full">Create initial administrator</button>
      </form>
      <p id="result" class="subtle" style="margin-top:12px"></p>
      <a class="btn full" href="./" style="margin-top:8px">Back to sign in</a>
    </div></section>
  </main>
  <script>
    window.ST_BUILD = <?= json_encode($build, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;
    window.ST_SUPABASE = <?= json_encode($publicConfig, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;
  </script>
  <script src="assets/supabase-client.js?v=<?= rawurlencode((string)filemtime(__DIR__ . '/assets/supabase-client.js')) ?>"></script>
  <script>
    document.getElementById('setup-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const result = document.getElementById('result');
      result.textContent = 'Creating administrator…';
      try {
        await window.ShineTimeSupabase.bootstrapFirstAdmin(Object.fromEntries(form));
        result.textContent = 'Done. You can now sign in.';
        formElement.reset();
      } catch (error) { result.textContent = error.message || 'Setup failed'; }
    });
  </script>
</body>
</html>
