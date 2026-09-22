<?php
declare(strict_types=1);

const ST_DEFAULT_SETTINGS = [
    'windowStart' => '10:00',
    'windowEnd' => '15:00',
    'travelBuffer' => 15,
    'sameZoneTravelBuffer' => 10,
    'safetyBuffer' => 10,
    'rescueStart' => '13:30',
    'surge2Start' => '11:30',
    'surge4Start' => '12:30',
    'surge6Start' => '13:30',
    'checkinRadiusMeters' => 250,
    'reserveTargetPct' => 20,
    'cleanerCancellationCutoffMinutes' => 90,
    'companyName' => 'Shine Time Operations',
    'timezone' => 'Europe/Bratislava',
    'clientBookingStepMinutes' => 30,
    'clientCancellationCutoffHours' => 12,
    'defaultLanguage' => 'ru',
];

function st_config_file(): string { return dirname(__DIR__) . '/config/database.php'; }
function st_is_installed(): bool { return is_file(st_config_file()); }

function st_db(?array $config = null): PDO {
    $config ??= require st_config_file();
    $host = $config['host'] ?? 'localhost';
    $port = (int)($config['port'] ?? 3306);
    $name = $config['database'] ?? '';
    $charset = 'utf8mb4';
    $dsn = "mysql:host={$host};port={$port};dbname={$name};charset={$charset}";
    return new PDO($dsn, $config['username'] ?? '', $config['password'] ?? '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
}

function st_now(): string { return date('Y-m-d H:i:s'); }
function st_today(): string { return date('Y-m-d'); }
function st_time(): string { return date('H:i'); }
function st_iso(?string $mysqlDateTime): ?string {
    if (!$mysqlDateTime) return null;
    $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', substr($mysqlDateTime,0,19), new DateTimeZone('Europe/Bratislava'));
    return $dt ? $dt->format(DateTimeInterface::ATOM) : str_replace(' ','T',$mysqlDateTime);
}
function st_time5(?string $time): ?string { return $time ? substr($time,0,5) : null; }
function st_json_decode(?string $value, mixed $fallback=[]): mixed {
    if ($value === null || $value === '') return $fallback;
    $decoded = json_decode($value,true);
    return json_last_error() === JSON_ERROR_NONE ? $decoded : $fallback;
}
function st_json(mixed $value): string { return json_encode($value, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES) ?: 'null'; }

function st_get_settings(PDO $db): array {
    $result = ST_DEFAULT_SETTINGS;
    $stmt = $db->query('SELECT setting_key,value_json FROM settings');
    foreach ($stmt->fetchAll() as $row) $result[$row['setting_key']] = st_json_decode($row['value_json'],$row['value_json']);
    return $result;
}
function st_set_setting(PDO $db,string $key,mixed $value): void {
    $stmt=$db->prepare('INSERT INTO settings(setting_key,value_json) VALUES(?,?) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json)');
    $stmt->execute([$key,st_json($value)]);
}
function st_seed_settings(PDO $db): void { foreach(ST_DEFAULT_SETTINGS as $k=>$v) st_set_setting($db,$k,$v); }

function st_add_event(PDO $db, ?int $jobId, ?int $userId, string $eventType, array $payload=[]): int {
    $stmt=$db->prepare('INSERT INTO job_events(job_id,user_id,event_type,payload_json) VALUES(?,?,?,?)');
    $stmt->execute([$jobId,$userId,$eventType,st_json($payload)]);
    return (int)$db->lastInsertId();
}
function st_notify(PDO $db,int $userId,string $type,string $title,string $message): int {
    $stmt=$db->prepare('INSERT INTO notifications(user_id,type,title,message) VALUES(?,?,?,?)');
    $stmt->execute([$userId,$type,$title,$message]);
    return (int)$db->lastInsertId();
}
function st_transaction(PDO $db, callable $fn): mixed {
    $db->beginTransaction();
    try { $r=$fn(); $db->commit(); return $r; }
    catch(Throwable $e){ if($db->inTransaction())$db->rollBack(); throw $e; }
}

function st_base_checklist(): array {
    return [
        ['Remove old linen',1,0,null],['Make beds',1,1,'Bedroom'],['Bathroom',1,1,'Bathroom'],['Toilet',1,0,null],
        ['Kitchen',1,1,'Kitchen'],['Check refrigerator',1,0,null],['Take out trash',1,0,null],['Vacuum',1,0,null],
        ['Mop floor',1,0,null],['Fresh towels',1,0,null],['Toilet paper',1,0,null],['Soap / amenities',1,0,null],
        ['Check windows',1,0,null],['Lights off',1,0,null],['Final living-area photo',1,1,'Living area'],['Final walkthrough',1,0,null],
    ];
}
function st_insert_default_checklist(PDO $db,int $objectId): void {
    $stmt=$db->prepare('INSERT INTO checklist_items(object_id,label,required,photo_required,photo_category,sort_order) VALUES(?,?,?,?,?,?)');
    foreach(st_base_checklist() as $i=>$item) $stmt->execute([$objectId,$item[0],$item[1],$item[2],$item[3],$i+1]);
}
function st_ensure_job_checklist(PDO $db,int $jobId,int $objectId): void {
    $stmt=$db->prepare('SELECT COUNT(*) FROM job_checklist WHERE job_id=?');$stmt->execute([$jobId]);
    if((int)$stmt->fetchColumn()>0)return;
    $stmt=$db->prepare('SELECT * FROM checklist_items WHERE object_id=? ORDER BY sort_order,id');$stmt->execute([$objectId]);
    $items=$stmt->fetchAll();
    $ins=$db->prepare('INSERT INTO job_checklist(job_id,checklist_item_id,label,required,photo_required,photo_category,sort_order) VALUES(?,?,?,?,?,?,?)');
    foreach($items as $i)$ins->execute([$jobId,$i['id'],$i['label'],$i['required'],$i['photo_required'],$i['photo_category'],$i['sort_order']]);
}
