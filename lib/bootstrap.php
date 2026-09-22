<?php
declare(strict_types=1);

define('ST_ROOT', dirname(__DIR__));
date_default_timezone_set('Europe/Bratislava');
require_once ST_ROOT . '/lib/db.php';
require_once ST_ROOT . '/lib/core.php';
require_once ST_ROOT . '/lib/migrations.php';

function st_base_path(): string {
    $script = $_SERVER['SCRIPT_NAME'] ?? '/app/index.php';
    $marker = '/api/';
    $pos = strpos($script,$marker);
    if ($pos !== false) return rtrim(substr($script,0,$pos),'/') . '/';
    $dir = str_replace('\\','/',dirname($script));
    return rtrim($dir==='/'?'':$dir,'/') . '/';
}
function st_is_https(): bool { return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'); }
function st_start_session(): void {
    if(session_status()===PHP_SESSION_ACTIVE)return;
    session_name('st_session');
    session_set_cookie_params([
        'lifetime'=>60*60*24*14,
        'path'=>st_base_path(),
        'secure'=>st_is_https(),
        'httponly'=>true,
        'samesite'=>'Lax',
    ]);
    session_start();
}
function st_csrf_token(): string {
    st_start_session();
    if(empty($_SESSION['csrf']))$_SESSION['csrf']=bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}
function st_verify_csrf(): void {
    $provided=$_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $expected=$_SESSION['csrf'] ?? '';
    if(!$expected || !$provided || !hash_equals($expected,$provided)) throw new STHttpException('Invalid security token',403);
}
class STHttpException extends RuntimeException {
    public function __construct(string $message, public int $status=400, public array $extra=[]) { parent::__construct($message); }
}
