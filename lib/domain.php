<?php
declare(strict_types=1);
require_once __DIR__.'/bootstrap.php';

function st_bool(mixed $v): bool { return $v===true || $v===1 || $v==='1' || $v==='true'; }
function st_num(mixed $v, float|int $fallback=0): float|int { return is_numeric($v) ? (str_contains((string)$v,'.')?(float)$v:(int)$v) : $fallback; }

function st_normalize_row(array $row): array {
    $ints=['id','user_id','cleaner_id','client_id','client_account_id','object_id','job_id','checklist_item_id','assigned_cleaner_id','created_by_user_id','bedrooms','bathrooms','duration_minutes','max_jobs_day','completed_jobs','risk_score','sort_order','file_size','today_jobs'];
    $bools=['active','user_active','online','marketplace_visible','issue_flag','required','photo_required','completed','cleaner_active'];
    $floats=['payout','client_price','bonus','extra_revenue','extra_cost','amount','lat','lng','last_lat','last_lng','checkin_lat','checkin_lng','reliability_score','rating','reclean_rate','cancellation_rate','avg_delay_minutes','today_earnings'];
    $times=['earliest_start','deadline','planned_start','eta','checkout_time','deadline_time','from_time','to_time'];
    $dates=['accepted_at','actual_checkin','actual_start','completed_at','created_at','updated_at','last_location_at','completed_at','resolved_at','read_at'];
    foreach($ints as $k)if(array_key_exists($k,$row)&&$row[$k]!==null)$row[$k]=(int)$row[$k];
    foreach($bools as $k)if(array_key_exists($k,$row)&&$row[$k]!==null)$row[$k]=(bool)$row[$k];
    foreach($floats as $k)if(array_key_exists($k,$row)&&$row[$k]!==null)$row[$k]=(float)$row[$k];
    foreach($times as $k)if(array_key_exists($k,$row)&&$row[$k]!==null)$row[$k]=substr((string)$row[$k],0,5);
    foreach($dates as $k)if(array_key_exists($k,$row)&&$row[$k]!==null)$row[$k]=str_replace(' ','T',(string)$row[$k]);
    return $row;
}
function st_rows(array $rows): array { return array_map('st_normalize_row',$rows); }

function st_current_user(PDO $db): ?array {
    st_start_session();
    $uid=(int)($_SESSION['user_id']??0); if(!$uid)return null;
    $stmt=$db->prepare("SELECT u.*,c.id cleaner_id,c.mode cleaner_mode,c.reliability_score,c.rating,c.transport,c.preferred_zones,c.max_jobs_day,c.active cleaner_active,ca.id client_id,ca.account_type client_account_type,ca.company_name,ca.billing_name,ca.ico,ca.dic,ca.ic_dph,ca.billing_address FROM users u LEFT JOIN cleaners c ON c.user_id=u.id LEFT JOIN client_accounts ca ON ca.user_id=u.id WHERE u.id=? AND u.active=1");
    $stmt->execute([$uid]);$u=$stmt->fetch();if(!$u)return null;
    $u=st_normalize_row($u);$u['preferred_zones']=st_json_decode($u['preferred_zones']??'[]',[]);$u['language']=st_valid_locale($u['language']??'ru');return $u;
}
function st_public_user(array $u): array {
    return [
        'id'=>(int)$u['id'],'email'=>$u['email'],'role'=>$u['role'],'full_name'=>$u['full_name'],'phone'=>$u['phone']??'','language'=>st_valid_locale($u['language']??'ru'),
        'cleaner_id'=>$u['cleaner_id']??null,'cleaner_mode'=>$u['cleaner_mode']??null,'reliability_score'=>$u['reliability_score']??null,
        'rating'=>$u['rating']??null,'transport'=>$u['transport']??null,'preferred_zones'=>$u['preferred_zones']??[],'max_jobs_day'=>$u['max_jobs_day']??null,
        'client_id'=>$u['client_id']??null,'client_account_type'=>$u['client_account_type']??null,'company_name'=>$u['company_name']??null,'billing_name'=>$u['billing_name']??null,
    ];
}
function st_authenticate(PDO $db,string $email,string $password): ?array {
    $stmt=$db->prepare('SELECT * FROM users WHERE LOWER(email)=LOWER(?) AND active=1 LIMIT 1');$stmt->execute([trim($email)]);$u=$stmt->fetch();
    return $u && password_verify($password,$u['password_hash']) ? st_normalize_row($u) : null;
}
function st_require_user(?array $user,string|array|null $role=null): array {
    if(!$user)throw new STHttpException('Authentication required',401);
    if($role){$roles=is_array($role)?$role:[$role];if(!in_array($user['role'],$roles,true))throw new STHttpException('Forbidden',403);}
    return $user;
}

function st_job_select(): string {
    return "SELECT j.*,o.code object_code,o.name object_name,o.address,o.zone,o.lat,o.lng,o.apartment_type,o.bedrooms,o.bathrooms,o.access_instructions,o.key_instructions,o.parking,o.linen_location,o.supplies_location,o.wifi,o.notes object_notes,o.client_price object_client_price,u.full_name cleaner_name,u.phone cleaner_phone,c.mode cleaner_mode,c.reliability_score cleaner_reliability,ca.company_name client_company,cu.full_name client_name FROM cleaning_jobs j JOIN objects o ON o.id=j.object_id LEFT JOIN cleaners c ON c.id=j.assigned_cleaner_id LEFT JOIN users u ON u.id=c.user_id LEFT JOIN client_accounts ca ON ca.id=j.client_id LEFT JOIN users cu ON cu.id=ca.user_id";
}
function st_get_job(PDO $db,int $id): ?array {
    $stmt=$db->prepare(st_job_select().' WHERE j.id=?');$stmt->execute([$id]);$r=$stmt->fetch();return $r?st_normalize_row($r):null;
}
function st_assigned_jobs(PDO $db,int $cleanerId,string $date): array {
    $stmt=$db->prepare(st_job_select()." WHERE j.assigned_cleaner_id=? AND j.service_date=? AND j.status!='CANCELLED' ORDER BY COALESCE(j.planned_start,j.earliest_start),j.id");
    $stmt->execute([$cleanerId,$date]);return st_rows($stmt->fetchAll());
}
function st_full_job(PDO $db,int $id,bool $includeSensitive=true): ?array {
    $job=st_get_job($db,$id);if(!$job)return null;
    if(!$includeSensitive)foreach(['access_instructions','key_instructions','linen_location','supplies_location','wifi'] as $k)unset($job[$k]);
    $job['risk_reasons']=st_json_decode((string)($job['risk_reasons']??'[]'),[]);
    $s=$db->prepare('SELECT * FROM job_checklist WHERE job_id=? ORDER BY sort_order,id');$s->execute([$id]);$check=st_rows($s->fetchAll());
    $s=$db->prepare('SELECT id,job_id,cleaner_id,checklist_item_id,category,file_name,mime,file_size,created_at FROM job_photos WHERE job_id=? ORDER BY created_at');$s->execute([$id]);$photos=st_rows($s->fetchAll());
    $s=$db->prepare('SELECT * FROM issues WHERE job_id=? ORDER BY created_at DESC');$s->execute([$id]);$issues=st_rows($s->fetchAll());foreach($issues as &$i)$i['photos']=st_json_decode($i['photos_json']??'[]',[]);unset($i);
    $s=$db->prepare('SELECT e.*,u.full_name actor_name FROM job_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.job_id=? ORDER BY e.id DESC LIMIT 100');$s->execute([$id]);$events=st_rows($s->fetchAll());foreach($events as &$e)$e['payload']=st_json_decode($e['payload_json']??'{}',[]);unset($e);
    return [...$job,'checklist'=>$check,'photos'=>$photos,'issues'=>$issues,'events'=>$events];
}

function st_decorate_job_risk(array $job,?string $now=null): array {
    if($now===null)$now=(!empty($job['service_date']) && $job['service_date']>st_today())?'10:00':st_time();$risk=st_score_job_risk($job,$now);
    $job['risk_score']=$risk['score'];$job['risk_level']=$risk['level'];$job['risk_reasons']=$risk['reasons'];$job['suggested_bonus']=st_suggested_bonus($job,$now);return $job;
}
function st_sync_risk(PDO $db,array $job,?string $now=null): array {
    $d=st_decorate_job_risk($job,$now);$should=$d['risk_level']==='RED' && empty($d['assigned_cleaner_id']) && in_array($d['status'],['UNASSIGNED','AT_RISK','RESCUE'],true);
    $next=$should?'RESCUE':$d['status'];$rescue=$should?'ACTIVE':($job['rescue_state']??'NONE');
    $stmt=$db->prepare('UPDATE cleaning_jobs SET risk_score=?,risk_level=?,risk_reasons=?,status=?,rescue_state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?');
    $stmt->execute([$d['risk_score'],$d['risk_level'],st_json($d['risk_reasons']),$next,$rescue,$job['id']]);$d['status']=$next;$d['rescue_state']=$rescue;return $d;
}

function st_cleaner_rows(PDO $db,string $date): array {
    $stmt=$db->prepare("SELECT c.*,u.full_name,u.email,u.phone,a.online,a.from_time,a.to_time FROM cleaners c JOIN users u ON u.id=c.user_id LEFT JOIN cleaner_availability a ON a.cleaner_id=c.id AND a.service_date=? WHERE c.active=1 AND u.active=1");
    $stmt->execute([$date]);$rows=st_rows($stmt->fetchAll());
    foreach($rows as &$r){$r['preferred_zones']=st_json_decode($r['preferred_zones']??'[]',[]);$r['available']=(bool)($r['online']??false);$r['availability']=['online'=>(bool)($r['online']??false),'fromTime'=>st_time5($r['from_time']??'10:00')??'10:00','toTime'=>st_time5($r['to_time']??'15:00')??'15:00'];}unset($r);return $rows;
}
function st_cleaner_dispatch_settings(PDO $db,int $cleanerId,string $date): array {
    $settings=st_get_settings($db);$q=$db->prepare('SELECT from_time,to_time FROM cleaner_availability WHERE cleaner_id=? AND service_date=?');$q->execute([$cleanerId,$date]);$a=$q->fetch();if($a){$settings['windowStart']=st_time5($a['from_time'])?:$settings['windowStart'];$settings['windowEnd']=st_time5($a['to_time'])?:$settings['windowEnd'];}return $settings;
}
function st_project_cleaner_day(PDO $db,int $cleanerId,string $date): array {
    $jobs=st_assigned_jobs($db,$cleanerId,$date);$settings=st_cleaner_dispatch_settings($db,$cleanerId,$date);
    $proj=st_project_schedule(array_map(fn($j)=>['id'=>$j['id'],'zone'=>$j['zone'],'durationMinutes'=>$j['duration_minutes'],'plannedStart'=>$j['planned_start']?:$j['earliest_start']],$jobs),$settings);
    foreach($jobs as $i=>&$j){$j['projected_start']=$proj['items'][$i]['start']??null;$j['projected_finish']=$proj['items'][$i]['finish']??null;}unset($j);
    return ['jobs'=>$jobs,'projectedFinish'=>$proj['finish']];
}
function st_update_job_plan_for_cleaner(PDO $db,int $cleanerId,string $date): array {
    $day=st_project_cleaner_day($db,$cleanerId,$date);$stmt=$db->prepare('UPDATE cleaning_jobs SET planned_start=?,eta=?,updated_at=CURRENT_TIMESTAMP WHERE id=?');
    foreach($day['jobs'] as $j)$stmt->execute([$j['projected_start'],$j['projected_finish'],$j['id']]);return st_project_cleaner_day($db,$cleanerId,$date);
}

function st_create_job_from_object(PDO $db,int $objectId,string $serviceDate,array $overrides=[]): array {
    $stmt=$db->prepare('SELECT * FROM objects WHERE id=? AND active=1');$stmt->execute([$objectId]);$o=$stmt->fetch();if(!$o)throw new STHttpException('Object not found',404);$o=st_normalize_row($o);
    $sql='INSERT INTO cleaning_jobs(object_id,client_id,service_date,earliest_start,deadline,duration_minutes,payout,client_price,bonus,extra_revenue,extra_cost,financial_status,booking_source,created_by_user_id,status,marketplace_visible,planned_start,risk_reasons) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
    try{$stmt=$db->prepare($sql);$stmt->execute([$o['id'],$overrides['clientId']??$o['client_id']??null,$serviceDate,$overrides['earliestStart']??$o['checkout_time']??'10:00',$overrides['deadline']??$o['deadline_time']??'15:00',(int)($overrides['durationMinutes']??$o['duration_minutes']),(float)($overrides['payout']??$o['payout']),(float)($overrides['clientPrice']??$o['client_price']??0),(float)($overrides['bonus']??0),(float)($overrides['extraRevenue']??0),(float)($overrides['extraCost']??0),$overrides['financialStatus']??'PENDING',$overrides['bookingSource']??'ADMIN',$overrides['createdByUserId']??null,$overrides['status']??'UNASSIGNED',array_key_exists('marketplaceVisible',$overrides)&&$overrides['marketplaceVisible']===false?0:1,$overrides['plannedStart']??$overrides['earliestStart']??$o['checkout_time']??'10:00','[]']);}
    catch(PDOException $e){if(($e->errorInfo[1]??0)===1062)throw new STHttpException('A job already exists for this object and date',409);throw $e;}
    $id=(int)$db->lastInsertId();st_ensure_job_checklist($db,$id,$o['id']);return st_get_job($db,$id)??[];
}

function st_create_cleaner_account(PDO $db,array $body): array {
    if(empty($body['email'])||empty($body['password'])||empty($body['fullName']))throw new STHttpException('email, password and fullName are required',400);
    if(strlen((string)$body['password'])<8)throw new STHttpException('Password must be at least 8 characters',400);
    return st_transaction($db,function()use($db,$body){
        try{$s=$db->prepare("INSERT INTO users(email,password_hash,role,full_name,phone,language,active) VALUES(?,?,'CLEANER',?,?,?,1)");$s->execute([strtolower(trim((string)$body['email'])),password_hash((string)$body['password'],PASSWORD_DEFAULT),$body['fullName'],$body['phone']??'',st_valid_locale($body['language']??'ru')]);}
        catch(PDOException $e){if(($e->errorInfo[1]??0)===1062)throw new STHttpException('Email already exists',409);throw $e;}
        $uid=(int)$db->lastInsertId();$s=$db->prepare("INSERT INTO cleaners(user_id,mode,reliability_score,rating,transport,preferred_zones,max_jobs_day,active) VALUES(?,?,?,?,?,?,?,1)");$s->execute([$uid,($body['mode']??'FLEX')==='GUARANTEE'?'GUARANTEE':'FLEX',(float)($body['reliabilityScore']??95),(float)($body['rating']??5),$body['transport']??'PUBLIC',st_json($body['preferredZones']??[]),(int)($body['maxJobsDay']??5)]);$cid=(int)$db->lastInsertId();
        $u=$db->prepare('SELECT * FROM users WHERE id=?');$u->execute([$uid]);$c=$db->prepare('SELECT * FROM cleaners WHERE id=?');$c->execute([$cid]);$clean=st_normalize_row($c->fetch());$clean['preferred_zones']=$body['preferredZones']??[];return ['user'=>st_normalize_row($u->fetch()),'cleaner'=>$clean];
    });
}

function st_capacity(PDO $db,string $date): array {
    $s=$db->prepare(st_job_select()." WHERE j.service_date=? AND j.status!='CANCELLED'");$s->execute([$date]);$jobs=st_rows($s->fetchAll());return st_summarize_capacity(st_cleaner_rows($db,$date),$jobs,st_get_settings($db));
}

function st_create_client_account(PDO $db,array $body): array {
    if(empty($body['email'])||empty($body['password'])||empty($body['fullName']))throw new STHttpException('email, password and fullName are required',400);
    if(strlen((string)$body['password'])<8)throw new STHttpException('Password must be at least 8 characters',400);
    $type=($body['accountType']??'OWNER')==='MANAGER'?'MANAGER':'OWNER';
    return st_transaction($db,function()use($db,$body,$type){
        try{$s=$db->prepare('INSERT INTO users(email,password_hash,role,full_name,phone,language,active) VALUES(?,?,?,?,?,?,1)');$s->execute([strtolower(trim((string)$body['email'])),password_hash((string)$body['password'],PASSWORD_DEFAULT),$type,$body['fullName'],$body['phone']??'',st_valid_locale($body['language']??'ru')]);}
        catch(PDOException $e){if(($e->errorInfo[1]??0)===1062)throw new STHttpException('Email already exists',409);throw $e;}
        $uid=(int)$db->lastInsertId();
        $s=$db->prepare('INSERT INTO client_accounts(user_id,account_type,company_name,billing_name,ico,dic,ic_dph,billing_address,notes) VALUES(?,?,?,?,?,?,?,?,?)');
        $s->execute([$uid,$type,$body['companyName']??null,$body['billingName']??null,$body['ico']??null,$body['dic']??null,$body['icDph']??null,$body['billingAddress']??null,$body['notes']??null]);
        $cid=(int)$db->lastInsertId();
        $q=$db->prepare('SELECT ca.*,u.full_name,u.email,u.phone,u.language,u.active user_active FROM client_accounts ca JOIN users u ON u.id=ca.user_id WHERE ca.id=?');$q->execute([$cid]);
        return ['client'=>st_normalize_row($q->fetch())];
    });
}

function st_client_account(PDO $db,int $clientId): ?array {
    $q=$db->prepare('SELECT ca.*,u.full_name,u.email,u.phone,u.language,u.active user_active FROM client_accounts ca JOIN users u ON u.id=ca.user_id WHERE ca.id=?');$q->execute([$clientId]);$r=$q->fetch();return $r?st_normalize_row($r):null;
}

function st_client_object(PDO $db,int $clientId,int $objectId,bool $approvedOnly=false): ?array {
    $sql='SELECT * FROM objects WHERE id=? AND client_id=?';if($approvedOnly)$sql.=" AND approval_status='APPROVED' AND active=1";
    $q=$db->prepare($sql);$q->execute([$objectId,$clientId]);$r=$q->fetch();return $r?st_normalize_row($r):null;
}

function st_client_booking_capacity(PDO $db,string $date): int {
    $q=$db->prepare('SELECT COUNT(*) FROM cleaner_availability a JOIN cleaners c ON c.id=a.cleaner_id JOIN users u ON u.id=c.user_id WHERE a.service_date=? AND c.active=1 AND u.active=1');$q->execute([$date]);$declared=(int)$q->fetchColumn();
    if($declared>0){$q=$db->prepare('SELECT COUNT(*) FROM cleaner_availability a JOIN cleaners c ON c.id=a.cleaner_id JOIN users u ON u.id=c.user_id WHERE a.service_date=? AND a.online=1 AND c.active=1 AND u.active=1');$q->execute([$date]);return (int)$q->fetchColumn();}
    return (int)$db->query('SELECT COUNT(*) FROM cleaners c JOIN users u ON u.id=c.user_id WHERE c.active=1 AND u.active=1')->fetchColumn();
}

function st_client_booking_slots(PDO $db,int $clientId,int $objectId,string $date): array {
    $o=st_client_object($db,$clientId,$objectId,true);if(!$o)throw new STHttpException('Object is not approved for booking',404);
    $q=$db->prepare("SELECT planned_start,earliest_start,duration_minutes,status FROM cleaning_jobs WHERE service_date=? AND status!='CANCELLED'");$q->execute([$date]);$jobs=st_rows($q->fetchAll());
    $settings=st_get_settings($db);$step=(int)($settings['clientBookingStepMinutes']??30);
    $q=$db->prepare('SELECT a.online,a.from_time,a.to_time FROM cleaner_availability a JOIN cleaners c ON c.id=a.cleaner_id JOIN users u ON u.id=c.user_id WHERE a.service_date=? AND c.active=1 AND u.active=1');$q->execute([$date]);$windows=st_rows($q->fetchAll());
    if(!$windows){$count=(int)$db->query('SELECT COUNT(*) FROM cleaners c JOIN users u ON u.id=c.user_id WHERE c.active=1 AND u.active=1')->fetchColumn();for($i=0;$i<$count;$i++)$windows[]=['online'=>true,'from_time'=>$settings['windowStart']??'10:00','to_time'=>$settings['windowEnd']??'15:00'];}
    $slots=st_booking_slots_for_windows($jobs,$windows,(int)$o['duration_minutes'],$settings,$step);
    if($date===st_today()){$min=st_to_minutes(st_time())+30;$slots=array_values(array_filter($slots,fn($slot)=>st_to_minutes($slot)>=$min));}
    return $slots;
}

function st_admin_finance_report(PDO $db,string $month): array {
    $bounds=st_month_bounds($month);
    $q=$db->prepare(st_job_select()." WHERE j.service_date BETWEEN ? AND ? ORDER BY j.service_date,j.id");$q->execute([$bounds['from'],$bounds['to']]);$jobs=st_rows($q->fetchAll());
    $q=$db->prepare('SELECT f.*,ca.company_name,u.full_name client_name,o.code object_code,o.name object_name FROM financial_entries f LEFT JOIN client_accounts ca ON ca.id=f.client_id LEFT JOIN users u ON u.id=ca.user_id LEFT JOIN objects o ON o.id=f.object_id WHERE f.entry_date BETWEEN ? AND ? ORDER BY f.entry_date DESC,f.id DESC');$q->execute([$bounds['from'],$bounds['to']]);$entries=st_rows($q->fetchAll());
    $summary=st_finance_summary($jobs,$entries);
    $byClient=[];$byObject=[];
    foreach($jobs as $j){if($j['status']!=='COMPLETED')continue;$revenue=(float)$j['client_price']+(float)$j['extra_revenue'];$cost=(float)$j['payout']+(float)$j['bonus']+(float)$j['extra_cost'];$profit=$revenue-$cost;
        $ck=(string)($j['client_id']??0);$byClient[$ck]??=['client_id'=>$j['client_id']??null,'name'=>$j['client_company']?:($j['client_name']?:'Unassigned client'),'jobs'=>0,'revenue'=>0.0,'cost'=>0.0,'profit'=>0.0];$byClient[$ck]['jobs']++;$byClient[$ck]['revenue']+=$revenue;$byClient[$ck]['cost']+=$cost;$byClient[$ck]['profit']+=$profit;
        $ok=(string)$j['object_id'];$byObject[$ok]??=['object_id'=>$j['object_id'],'code'=>$j['object_code'],'name'=>$j['object_name'],'jobs'=>0,'revenue'=>0.0,'cost'=>0.0,'profit'=>0.0];$byObject[$ok]['jobs']++;$byObject[$ok]['revenue']+=$revenue;$byObject[$ok]['cost']+=$cost;$byObject[$ok]['profit']+=$profit;
    }
    foreach($entries as $e){$sign=$e['entry_type']==='INCOME'?1:-1;if(!empty($e['client_id'])){$ck=(string)$e['client_id'];$byClient[$ck]??=['client_id'=>$e['client_id'],'name'=>$e['company_name']?:($e['client_name']?:'Client'),'jobs'=>0,'revenue'=>0.0,'cost'=>0.0,'profit'=>0.0];if($sign>0)$byClient[$ck]['revenue']+=(float)$e['amount'];else $byClient[$ck]['cost']+=(float)$e['amount'];$byClient[$ck]['profit']=$byClient[$ck]['revenue']-$byClient[$ck]['cost'];}}
    foreach($byClient as &$x){$x['revenue']=round($x['revenue'],2);$x['cost']=round($x['cost'],2);$x['profit']=round($x['profit'],2);}unset($x);
    foreach($byObject as &$x){$x['revenue']=round($x['revenue'],2);$x['cost']=round($x['cost'],2);$x['profit']=round($x['profit'],2);}unset($x);
    usort($byClient,fn($a,$b)=>$b['revenue']<=>$a['revenue']);usort($byObject,fn($a,$b)=>$b['revenue']<=>$a['revenue']);
    $trend=[];$cursor=(new DateTimeImmutable($bounds['from']))->modify('-11 months');for($i=0;$i<12;$i++){$m=$cursor->format('Y-m');$b=st_month_bounds($m);$q=$db->prepare('SELECT status,client_price,extra_revenue,payout,bonus,extra_cost FROM cleaning_jobs WHERE service_date BETWEEN ? AND ?');$q->execute([$b['from'],$b['to']]);$tj=st_rows($q->fetchAll());$q=$db->prepare('SELECT entry_type,amount FROM financial_entries WHERE entry_date BETWEEN ? AND ?');$q->execute([$b['from'],$b['to']]);$te=st_rows($q->fetchAll());$ts=st_finance_summary($tj,$te);$trend[]=['month'=>$m,'revenue'=>$ts['totalRevenue'],'expenses'=>$ts['totalExpenses'],'profit'=>$ts['profit'],'jobs'=>$ts['completedJobs']];$cursor=$cursor->modify('+1 month');}
    return ['month'=>$bounds['month'],'from'=>$bounds['from'],'to'=>$bounds['to'],'summary'=>$summary,'entries'=>$entries,'byClient'=>array_values($byClient),'byObject'=>array_values($byObject),'trend'=>$trend,'jobs'=>$jobs];
}

function st_client_job_public(array $j): array {
    $allowed=['id','object_id','client_id','service_date','earliest_start','deadline','duration_minutes','client_price','extra_revenue','financial_status','booking_source','status','marketplace_visible','planned_start','actual_checkin','actual_start','completed_at','eta','risk_level','issue_flag','created_at','updated_at','object_code','object_name','address','zone','apartment_type','bedrooms','bathrooms','client_company','client_name'];
    $out=[];foreach($allowed as $k)if(array_key_exists($k,$j))$out[$k]=$j[$k];return $out;
}
