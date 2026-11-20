-- Overdue cleanings (owner request 2026-11-20).
-- Automatic expiry only closes cleanings nobody took. A cleaning a cleaner accepted but never
-- finished stayed open forever with no signal. The dispatch tick now tells staff once when such a
-- cleaning passes its deadline; the operations board lists them (st-api admin/jobs "overdue").

alter table public.st_jobs add column if not exists overdue_notified_at timestamptz;

create or replace function public.st_dispatch_tick() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare n_exp int:=0;n_esc int:=0;n_res int:=0;n_late int:=0;nowl timestamp:=now() at time zone 'Europe/Bratislava';
 esc_h int:=coalesce((select value_json::text::int from st_settings where setting_key='managerEscalationHours'),24);
 res_h int:=coalesce((select value_json::text::int from st_settings where setting_key='rescueHours'),3);
 r record;
begin
 for r in select j.id,o.code from st_jobs j join st_objects o on o.id=j.object_id
   where j.status in ('UNASSIGNED','OFFERED','AT_RISK','RESCUE') and j.service_date+j.deadline<nowl for update of j skip locked loop
   update st_jobs set status='EXPIRED',marketplace_visible=false,expired_at=now() where id=r.id;
   insert into st_job_events(job_id,event_type,payload_json) values(r.id,'EXPIRED','{}'::jsonb);
   perform st_notify_staff('EXPIRED','Cleaning expired without a cleaner',r.code||' · #'||r.id);n_exp:=n_exp+1;
 end loop;
 for r in select j.id,o.code from st_jobs j join st_objects o on o.id=j.object_id
   where j.status='UNASSIGNED' and j.assigned_cleaner_id is null and j.rescue_state='NONE' and j.service_date+j.earliest_start<=nowl+make_interval(hours=>res_h) for update of j skip locked loop
   update st_jobs set status='RESCUE',rescue_state='ACTIVE',marketplace_visible=true where id=r.id;
   insert into st_job_events(job_id,event_type,payload_json) values(r.id,'RESCUE_OPENED',jsonb_build_object('automatic',true));
   perform st_notify_staff('RESCUE','Rescue opened automatically',r.code||' · #'||r.id);
   insert into st_notifications(user_id,type,title,message) select cl.user_id,'RESCUE','Urgent cleaning',r.code from st_cleaners cl join st_users cu on cu.id=cl.user_id and cu.active where cl.active;
   n_res:=n_res+1;
 end loop;
 for r in select j.id,o.code from st_jobs j join st_objects o on o.id=j.object_id
   where j.status='UNASSIGNED' and j.assigned_cleaner_id is null and j.escalated_at is null and j.service_date+j.earliest_start<=nowl+make_interval(hours=>esc_h) for update of j skip locked loop
   update st_jobs set escalated_at=now() where id=r.id;
   perform st_notify_staff('ESCALATION','No cleaner yet — assign manually',r.code||' · #'||r.id);n_esc:=n_esc+1;
 end loop;
 -- A cleaner took the job but it is still open after the deadline: tell staff once.
 for r in select j.id,o.code from st_jobs j join st_objects o on o.id=j.object_id
   where j.status in ('ACCEPTED','EN_ROUTE','ARRIVED','CLEANING') and j.overdue_notified_at is null and j.service_date+j.deadline<nowl for update of j skip locked loop
   update st_jobs set overdue_notified_at=now() where id=r.id;
   insert into st_job_events(job_id,event_type,payload_json) values(r.id,'OVERDUE','{}'::jsonb);
   perform st_notify_staff('OVERDUE','Cleaning not finished by the deadline',r.code||' · #'||r.id);n_late:=n_late+1;
 end loop;
 return jsonb_build_object('expired',n_exp,'escalated',n_esc,'rescue',n_res,'overdue',n_late);
end $$;
revoke all on function public.st_dispatch_tick() from public,anon,authenticated;
grant execute on function public.st_dispatch_tick() to service_role;
