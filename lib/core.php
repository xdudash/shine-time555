<?php
declare(strict_types=1);

function st_to_minutes(string|int|float|null $value): int {
    if (is_int($value) || is_float($value)) return (int)round($value);
    $value = substr((string)($value ?? '00:00'), 0, 5);
    [$h, $m] = array_pad(array_map('intval', explode(':', $value)), 2, 0);
    return $h * 60 + $m;
}

function st_to_time(int|float $minutes): string {
    $safe = max(0, (int)round($minutes));
    return str_pad((string)intdiv($safe, 60), 2, '0', STR_PAD_LEFT) . ':' . str_pad((string)($safe % 60), 2, '0', STR_PAD_LEFT);
}

function st_dispatch_settings(array $settings = []): array {
    return [
        'windowStart' => $settings['windowStart'] ?? '10:00',
        'windowEnd' => $settings['windowEnd'] ?? '15:00',
        'travelBuffer' => (int)($settings['travelBuffer'] ?? 15),
        'sameZoneTravelBuffer' => (int)($settings['sameZoneTravelBuffer'] ?? 10),
        'safetyBuffer' => (int)($settings['safetyBuffer'] ?? 10),
    ];
}

function st_project_schedule(array $jobs, array $settings = []): array {
    $cfg = st_dispatch_settings($settings);
    $cursor = st_to_minutes($cfg['windowStart']);
    $previous = null;
    $items = [];
    foreach ($jobs as $job) {
        if ($previous !== null) {
            $sameZone = !empty($previous['zone']) && !empty($job['zone']) && $previous['zone'] === $job['zone'];
            $cursor += ($sameZone ? $cfg['sameZoneTravelBuffer'] : $cfg['travelBuffer']) + $cfg['safetyBuffer'];
        }
        $planned = $job['plannedStart'] ?? $job['planned_start'] ?? null;
        if ($planned) $cursor = max($cursor, st_to_minutes((string)$planned));
        $start = $cursor;
        $duration = (int)($job['durationMinutes'] ?? $job['duration_minutes'] ?? $job['estimatedDuration'] ?? 60);
        $finish = $start + $duration;
        $copy = $job;
        $copy['start'] = st_to_time($start);
        $copy['finish'] = st_to_time($finish);
        $copy['startMinutes'] = $start;
        $copy['finishMinutes'] = $finish;
        $items[] = $copy;
        $cursor = $finish;
        $previous = $job;
    }
    return [
        'items' => $items,
        'finish' => count($items) ? $items[count($items)-1]['finish'] : $cfg['windowStart'],
        'finishMinutes' => $cursor,
        'deadlineMinutes' => st_to_minutes($cfg['windowEnd']),
    ];
}

function st_can_accept_job(array $existingJobs, array $candidate, array $settings = []): array {
    $cfg = st_dispatch_settings($settings);
    $combined = [...$existingJobs, $candidate];
    usort($combined, function(array $a,array $b): int {
        $ta = st_to_minutes((string)($a['plannedStart'] ?? $a['planned_start'] ?? '10:00'));
        $tb = st_to_minutes((string)($b['plannedStart'] ?? $b['planned_start'] ?? '10:00'));
        return $ta <=> $tb ?: ((int)($a['id'] ?? 0) <=> (int)($b['id'] ?? 0));
    });
    $schedule = st_project_schedule($combined, $cfg);
    $deadline = st_to_minutes((string)($candidate['deadline'] ?? $cfg['windowEnd']));
    if ($schedule['finishMinutes'] > $deadline) {
        return [
            'ok' => false,
            'reason' => 'Would finish at ' . $schedule['finish'] . ', after ' . st_to_time($deadline) . ' deadline',
            'projectedFinish' => $schedule['finish'],
            'schedule' => $schedule,
        ];
    }
    return ['ok'=>true,'reason'=>null,'projectedFinish'=>$schedule['finish'],'schedule'=>$schedule];
}

function st_generate_smart_bundles(array $availableJobs, array $existingJobs, array $settings = [], int $maxBundle = 4): array {
    $groups = [];
    foreach ($availableJobs as $job) $groups[$job['zone'] ?? 'Other'][] = $job;
    $bundles = [];
    foreach ($groups as $zone => $jobs) {
        usort($jobs, fn($a,$b) => (($b['payout'] ?? 0)+($b['bonus'] ?? 0)) <=> (($a['payout'] ?? 0)+($a['bonus'] ?? 0)));
        for ($size=min($maxBundle,count($jobs)); $size>=2; $size--) {
            $candidate = array_slice($jobs,0,$size);
            $scheduled = $existingJobs;
            $ok = true;
            foreach ($candidate as $job) {
                $check = st_can_accept_job($scheduled,$job,$settings);
                if (!$check['ok']) { $ok=false; break; }
                $scheduled[] = $job;
            }
            if ($ok) {
                $projection = st_project_schedule($scheduled,$settings);
                $payout = array_reduce($candidate,fn($s,$j)=>$s+(float)($j['payout']??0)+(float)($j['bonus']??0),0.0);
                $bundles[] = ['zone'=>$zone,'jobIds'=>array_column($candidate,'id'),'jobs'=>$candidate,'count'=>count($candidate),'payout'=>$payout,'projectedFinish'=>$projection['finish']];
                break;
            }
        }
    }
    usort($bundles, fn($a,$b)=>$b['payout'] <=> $a['payout']);
    return array_slice($bundles,0,6);
}

function st_level_for_risk(int $score): string {
    return $score >= 70 ? 'RED' : ($score >= 45 ? 'ORANGE' : 'GREEN');
}

function st_score_job_risk(array $job, string $currentTime): array {
    $status = $job['status'] ?? 'UNASSIGNED';
    if (in_array($status,['COMPLETED','CANCELLED'],true)) return ['score'=>0,'level'=>'GREEN','reasons'=>[]];
    $now = st_to_minutes($currentTime);
    $score = 5;
    $reasons = [];
    $assigned = $job['assignedCleanerId'] ?? $job['assigned_cleaner_id'] ?? null;
    $unassigned = !$assigned || in_array($status,['UNASSIGNED','OFFERED'],true);
    if ($unassigned) {
        if ($now >= 13*60+30) { $score += 78; $reasons[]="Unassigned at $currentTime"; }
        elseif ($now >= 13*60) { $score += 65; $reasons[]="Unassigned after 13:00 ($currentTime)"; }
        elseif ($now >= 12*60) { $score += 45; $reasons[]="Unassigned after 12:00 ($currentTime)"; }
        elseif ($now >= 11*60) { $score += 25; $reasons[]="Unassigned at $currentTime"; }
        else { $score += 10; $reasons[]='Unassigned'; }
    }
    $planned = $job['plannedStart'] ?? $job['planned_start'] ?? null;
    if ($planned && $assigned && !in_array($status,['EN_ROUTE','ARRIVED','CLEANING','COMPLETED'],true)) {
        $overdue = $now - st_to_minutes((string)$planned);
        if ($overdue > 10) { $score += min(35,15+$overdue); $reasons[]="Cleaner $overdue min behind planned start"; }
    }
    if (!empty($job['eta'])) {
        $eta = st_to_minutes((string)$job['eta']);
        if ($eta > 15*60) { $score += 75; $reasons[]='Projected finish ' . $job['eta'] . ' is after 15:00'; }
        elseif ($eta > 14*60+30) { $score += 38; $reasons[]='Projected finish ' . $job['eta'] . ' is close to deadline'; }
    }
    $issue = $job['issueFlag'] ?? $job['issue_flag'] ?? false;
    if ($issue) { $score += 18; $reasons[]='Open operational issue'; }
    if ($status === 'RESCUE') { $score=max($score,80); $reasons[]='Rescue mode active'; }
    $score=min(100,$score);
    return ['score'=>$score,'level'=>st_level_for_risk($score),'reasons'=>array_values(array_unique($reasons))];
}

function st_suggested_bonus(array $job, string $currentTime): int {
    $assigned = $job['assignedCleanerId'] ?? $job['assigned_cleaner_id'] ?? null;
    $status = $job['status'] ?? 'UNASSIGNED';
    if ($assigned || !in_array($status,['UNASSIGNED','OFFERED','AT_RISK','RESCUE'],true)) return 0;
    $now = st_to_minutes($currentTime);
    if ($now >= 13*60+30) return 6;
    if ($now >= 12*60+30) return 4;
    if ($now >= 11*60+30) return 2;
    return 0;
}

function st_effective_marketplace_bonus(array $job, string $currentTime): float {
    return max((float)($job['bonus'] ?? 0), (float)st_suggested_bonus($job,$currentTime));
}

function st_summarize_capacity(array $cleaners, array $jobs, array $settings = []): array {
    $cfg=st_dispatch_settings($settings);
    $active=array_values(array_filter($cleaners,fn($c)=>($c['active']??true)!==false && ($c['available']??true)!==false));
    $capacity=0;
    foreach($active as $c){
        $a=$c['availability']??$c;
        $capacity+=max(0,st_to_minutes((string)($a['toTime']??$a['to_time']??$cfg['windowEnd']))-st_to_minutes((string)($a['fromTime']??$a['from_time']??$cfg['windowStart'])));
    }
    $defaultBuffer=$cfg['safetyBuffer']+$cfg['travelBuffer'];
    $demand=0;
    foreach($jobs as $j) if(($j['status']??'')!=='CANCELLED') $demand+=(int)($j['durationMinutes']??$j['duration_minutes']??60)+$defaultBuffer;
    $reserve=$capacity-$demand;
    $reservePct=$demand?round(($reserve/$demand)*100,1):100.0;
    return ['cleaners'=>count($active),'capacityMinutes'=>$capacity,'demandMinutes'=>$demand,'reserveMinutes'=>$reserve,'reservePct'=>$reservePct,'health'=>$reservePct>=20?'GREEN':($reservePct>=10?'ORANGE':'RED')];
}

function st_distance_meters(float $lat1,float $lon1,float $lat2,float $lon2): float {
    $earth=6371000.0;$p1=deg2rad($lat1);$p2=deg2rad($lat2);$dp=deg2rad($lat2-$lat1);$dl=deg2rad($lon2-$lon1);
    $a=sin($dp/2)**2+cos($p1)*cos($p2)*sin($dl/2)**2;
    return $earth*2*atan2(sqrt($a),sqrt(1-$a));
}

function st_valid_locale(?string $locale): string {
    $locale = strtolower(trim((string)$locale));
    return in_array($locale, ['ru','sk','uk','en'], true) ? $locale : 'ru';
}

function st_month_bounds(?string $month): array {
    $month = (string)$month;
    if (!preg_match('/^\d{4}-\d{2}$/', $month)) $month = date('Y-m');
    $dt = DateTimeImmutable::createFromFormat('!Y-m-d', $month . '-01');
    if (!$dt || $dt->format('Y-m') !== $month) $dt = new DateTimeImmutable(date('Y-m-01'));
    return ['month'=>$dt->format('Y-m'),'from'=>$dt->format('Y-m-01'),'to'=>$dt->format('Y-m-t')];
}

function st_finance_summary(array $jobs, array $entries=[]): array {
    $cleaningRevenue = 0.0;
    $cleanerPayouts = 0.0;
    $cleanerBonuses = 0.0;
    $jobExtraCosts = 0.0;
    $manualIncome = 0.0;
    $manualExpenses = 0.0;
    $completedJobs = 0;
    foreach ($jobs as $job) {
        if (($job['status'] ?? '') !== 'COMPLETED') continue;
        $completedJobs++;
        $cleaningRevenue += (float)($job['client_price'] ?? 0) + (float)($job['extra_revenue'] ?? 0);
        $cleanerPayouts += (float)($job['payout'] ?? 0);
        $cleanerBonuses += (float)($job['bonus'] ?? 0);
        $jobExtraCosts += (float)($job['extra_cost'] ?? 0);
    }
    foreach ($entries as $entry) {
        $amount = max(0.0, (float)($entry['amount'] ?? 0));
        if (($entry['entry_type'] ?? '') === 'INCOME') $manualIncome += $amount;
        elseif (($entry['entry_type'] ?? '') === 'EXPENSE') $manualExpenses += $amount;
    }
    $totalRevenue = $cleaningRevenue + $manualIncome;
    $totalExpenses = $cleanerPayouts + $cleanerBonuses + $jobExtraCosts + $manualExpenses;
    $profit = $totalRevenue - $totalExpenses;
    return [
        'completedJobs'=>$completedJobs,
        'cleaningRevenue'=>round($cleaningRevenue,2),
        'cleanerPayouts'=>round($cleanerPayouts,2),
        'cleanerBonuses'=>round($cleanerBonuses,2),
        'jobExtraCosts'=>round($jobExtraCosts,2),
        'manualIncome'=>round($manualIncome,2),
        'manualExpenses'=>round($manualExpenses,2),
        'totalRevenue'=>round($totalRevenue,2),
        'totalExpenses'=>round($totalExpenses,2),
        'profit'=>round($profit,2),
        'marginPct'=>$totalRevenue > 0 ? round(($profit / $totalRevenue) * 100,1) : 0.0,
        'avgRevenuePerJob'=>$completedJobs > 0 ? round($cleaningRevenue / $completedJobs,2) : 0.0,
        'avgProfitPerJob'=>$completedJobs > 0 ? round(($cleaningRevenue - $cleanerPayouts - $cleanerBonuses - $jobExtraCosts) / $completedJobs,2) : 0.0,
    ];
}

function st_booking_slots(array $jobs, int $concurrentCapacity, int $durationMinutes, array $settings=[], int $stepMinutes=30): array {
    $cfg = st_dispatch_settings($settings);
    $capacity = max(0, $concurrentCapacity);
    if ($capacity < 1 || $durationMinutes < 1) return [];
    $start = st_to_minutes($cfg['windowStart']);
    $end = st_to_minutes($cfg['windowEnd']);
    $step = max(15, $stepMinutes);
    $slots = [];
    for ($candidateStart = $start; $candidateStart + $durationMinutes <= $end; $candidateStart += $step) {
        $candidateEnd = $candidateStart + $durationMinutes;
        $overlap = 0;
        foreach ($jobs as $job) {
            if (($job['status'] ?? '') === 'CANCELLED') continue;
            $jobStart = st_to_minutes((string)($job['planned_start'] ?? $job['earliest_start'] ?? $cfg['windowStart']));
            $jobEnd = $jobStart + (int)($job['duration_minutes'] ?? $job['durationMinutes'] ?? 60);
            if ($candidateStart < $jobEnd && $candidateEnd > $jobStart) $overlap++;
        }
        if ($overlap < $capacity) $slots[] = st_to_time($candidateStart);
    }
    return $slots;
}

/**
 * Return client-bookable start times while respecting each cleaner's declared
 * availability window. This is a conservative capacity check, not a final
 * assignment: existing concurrent jobs consume one available cleaner slot.
 */
function st_booking_slots_for_windows(array $jobs, array $availabilityWindows, int $durationMinutes, array $settings=[], int $stepMinutes=30): array {
    $cfg=st_dispatch_settings($settings);
    if($durationMinutes<1)return [];
    $windows=array_values(array_filter($availabilityWindows,function($w){
        $online=$w['online']??true;
        return $online===true||$online===1||$online==='1'||$online==='true';
    }));
    if(!$windows)return [];
    $start=st_to_minutes($cfg['windowStart']);$end=st_to_minutes($cfg['windowEnd']);$step=max(15,$stepMinutes);$slots=[];
    for($candidateStart=$start;$candidateStart+$durationMinutes<=$end;$candidateStart+=$step){
        $candidateEnd=$candidateStart+$durationMinutes;$capacity=0;
        foreach($windows as $w){
            $from=st_to_minutes((string)($w['from_time']??$w['fromTime']??$cfg['windowStart']));
            $to=st_to_minutes((string)($w['to_time']??$w['toTime']??$cfg['windowEnd']));
            if($candidateStart>=$from&&$candidateEnd<=$to)$capacity++;
        }
        if($capacity<1)continue;
        $overlap=0;
        foreach($jobs as $job){
            if(($job['status']??'')==='CANCELLED')continue;
            $jobStart=st_to_minutes((string)($job['planned_start']??$job['earliest_start']??$cfg['windowStart']));
            $jobEnd=$jobStart+(int)($job['duration_minutes']??$job['durationMinutes']??60);
            if($candidateStart<$jobEnd&&$candidateEnd>$jobStart)$overlap++;
        }
        if($overlap<$capacity)$slots[]=st_to_time($candidateStart);
    }
    return $slots;
}
