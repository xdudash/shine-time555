create table public.st_recurring_runs (
 id bigint generated always as identity primary key,
 recurring_id bigint references st_recurring(id) on delete set null,
 started_at timestamptz not null default now(),
 result_json jsonb,
 error_message text
);
alter table st_recurring_runs enable row level security;
revoke all on st_recurring_runs from public,anon,authenticated;
create index st_recurring_runs_date_idx on st_recurring_runs(started_at desc);

-- Called by a database scheduler as postgres, or the trusted service role only.
create function public.st_run_recurring(p_horizon integer default 30) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;actor bigint;outcome jsonb;done integer:=0;failed integer:=0;today_date date;
begin
 if p_horizon is null or p_horizon<1 or p_horizon>90 then raise exception 'Invalid horizon';end if;
 if not pg_try_advisory_xact_lock(hashtext('st_recurring_worker')) then return jsonb_build_object('busy',true);end if;
 today_date:=(now() at time zone 'Europe/Bratislava')::date;
 select id into actor from st_users where active and role='ADMIN' order by id limit 1;
 if actor is null then raise exception 'Active administrator required';end if;
 for r in select id from st_recurring where active and start_date<=today_date+p_horizon and (end_date is null or end_date>=today_date) order by id loop
  begin
   outcome:=st_generate_recurring(actor,r.id,today_date+p_horizon);
   insert into st_recurring_runs(recurring_id,result_json) values(r.id,outcome);
   done:=done+1;
  exception when others then
   insert into st_recurring_runs(recurring_id,error_message) values(r.id,left(sqlerrm,1000));
   failed:=failed+1;
  end;
 end loop;
 delete from st_recurring_runs where started_at<now()-interval '90 days';
 return jsonb_build_object('processed',done,'failed',failed,'through',today_date+p_horizon);
end $$;
revoke all on function st_run_recurring(integer) from public,anon,authenticated;
grant execute on function st_run_recurring(integer) to service_role;
