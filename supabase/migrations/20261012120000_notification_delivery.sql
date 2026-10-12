-- Stage 1, fix 5: deliver notifications outside the application.
-- Owner decision of 2026-10-12: push and email only (no SMS, no card payments).
-- Push is Web Push on our own VAPID keys; email goes through the domain's SMTP.
-- Every row written to st_notifications is fanned out into an outbox that the
-- st-api worker drains. The database never talks to the network itself: a cron
-- job asks the Edge Function to drain the outbox (deployment/notifications-schedule.sql).

-- 1. Per-user channel choice. Both channels start on; the person can turn either off.
alter table public.st_users add column if not exists notify_push boolean not null default true;
alter table public.st_users add column if not exists notify_email boolean not null default true;

-- 2. Browser push subscriptions. One row per browser; the endpoint identifies it.
create table if not exists public.st_push_subscriptions (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.st_users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failures integer not null default 0
);
create index if not exists st_push_subscriptions_user_idx on public.st_push_subscriptions(user_id);

-- 3. The outbox. One row per notification per channel.
create table if not exists public.st_notification_outbox (
  id bigint generated always as identity primary key,
  notification_id bigint references public.st_notifications(id) on delete cascade,
  user_id bigint not null references public.st_users(id) on delete cascade,
  channel text not null check (channel in ('PUSH','EMAIL')),
  type text not null,
  title text not null,
  message text not null,
  payload_json jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED','SKIPPED')),
  attempts integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists st_notification_outbox_queue_idx on public.st_notification_outbox(status, created_at)
  where status in ('PENDING','SENDING');
create index if not exists st_notification_outbox_user_idx on public.st_notification_outbox(user_id, created_at desc);

alter table public.st_push_subscriptions enable row level security;
alter table public.st_notification_outbox enable row level security;
drop policy if exists st_push_subscriptions_backend_only on public.st_push_subscriptions;
create policy st_push_subscriptions_backend_only on public.st_push_subscriptions for all to anon, authenticated using (false) with check (false);
drop policy if exists st_notification_outbox_backend_only on public.st_notification_outbox;
create policy st_notification_outbox_backend_only on public.st_notification_outbox for all to anon, authenticated using (false) with check (false);
revoke all on public.st_push_subscriptions, public.st_notification_outbox from anon, authenticated;

-- 4. Which notification types are worth an email. Push gets everything the person
--    asked for; email is for the things that matter when the app is closed.
insert into public.st_settings(setting_key, value_json) values
  ('emailNotificationTypes','["CLIENT_BOOKING","ASSIGNED","RESCUE","EXPIRED","ESCALATION","REVIEW_REJECTED","SETTLEMENT"]'),
  ('notificationRetryLimit','5'),
  ('notificationBatchSize','25')
on conflict (setting_key) do nothing;

-- 5. Fan out. A notification row is the single source: whoever inserts one
--    (st_notify_staff, st_job_command, st_dispatch_tick, the API) gets delivery
--    for free and cannot forget a channel.
create or replace function public.st_enqueue_notification() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare u public.st_users%rowtype; email_types jsonb;
begin
  select * into u from public.st_users where id=new.user_id;
  if not found or not u.active then return new; end if;
  if u.notify_push and exists(select 1 from public.st_push_subscriptions where user_id=new.user_id) then
    insert into public.st_notification_outbox(notification_id,user_id,channel,type,title,message)
      values(new.id,new.user_id,'PUSH',new.type,new.title,new.message);
  end if;
  email_types := coalesce((select value_json from public.st_settings where setting_key='emailNotificationTypes'),'[]'::jsonb);
  if u.notify_email and coalesce(u.email,'')<>'' and email_types ? new.type then
    insert into public.st_notification_outbox(notification_id,user_id,channel,type,title,message,payload_json)
      values(new.id,new.user_id,'EMAIL',new.type,new.title,new.message,jsonb_build_object('language',coalesce(u.language,'sk')));
  end if;
  return new;
end $$;

drop trigger if exists st_notifications_enqueue on public.st_notifications;
create trigger st_notifications_enqueue after insert on public.st_notifications
  for each row execute function public.st_enqueue_notification();

-- 6. Worker RPCs. The worker claims a batch, sends it, then reports each row.
--    `skip locked` keeps two overlapping runs from sending the same message twice,
--    and a row stuck in SENDING for 10 minutes is retried.
create or replace function public.st_claim_notifications(p_limit integer default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare lim int; retries int; claimed jsonb;
begin
  lim := greatest(1,least(100,coalesce(p_limit,(select value_json::text::int from public.st_settings where setting_key='notificationBatchSize'),25)));
  retries := greatest(1,coalesce((select value_json::text::int from public.st_settings where setting_key='notificationRetryLimit'),5));
  with batch as (
    select o.id from public.st_notification_outbox o
    where (o.status='PENDING' or (o.status='SENDING' and o.claimed_at < now() - interval '10 minutes'))
      and o.attempts < retries
    order by o.created_at
    for update skip locked
    limit lim
  ), claimed_rows as (
    update public.st_notification_outbox o
      set status='SENDING', attempts=o.attempts+1, claimed_at=now()
      where o.id in (select id from batch)
      returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,'channel',c.channel,'type',c.type,'title',c.title,'message',c.message,
      'language',coalesce(c.payload_json->>'language',u.language,'sk'),
      'attempts',c.attempts,
      'email',case when c.channel='EMAIL' then u.email else null end,
      'recipientName',u.full_name,
      'subscriptions',case when c.channel='PUSH' then coalesce((
        select jsonb_agg(jsonb_build_object('id',s.id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth))
        from public.st_push_subscriptions s where s.user_id=c.user_id),'[]'::jsonb) else '[]'::jsonb end
    ) order by c.id),'[]'::jsonb)
    into claimed
    from claimed_rows c join public.st_users u on u.id=c.user_id;
  return jsonb_build_object('rows',claimed);
end $$;

create or replace function public.st_report_notifications(p_results jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; sent int:=0; failed int:=0; pruned int:=0; retries int;
begin
  retries := greatest(1,coalesce((select value_json::text::int from public.st_settings where setting_key='notificationRetryLimit'),5));
  for r in select jsonb_array_elements(coalesce(p_results->'results','[]'::jsonb)) loop
    if coalesce((r->>'ok')::boolean,false) then
      update public.st_notification_outbox set status='SENT', sent_at=now(), last_error=null where id=(r->>'id')::bigint;
      sent := sent+1;
    else
      update public.st_notification_outbox
        set status=case when attempts>=retries then 'FAILED' else 'PENDING' end,
            last_error=left(coalesce(r->>'error','unknown'),500)
        where id=(r->>'id')::bigint;
      failed := failed+1;
    end if;
    -- A push endpoint the browser has thrown away (404/410) is removed, not retried.
    if r ? 'goneSubscriptionIds' then
      delete from public.st_push_subscriptions where id in (
        select (value)::bigint from jsonb_array_elements_text(r->'goneSubscriptionIds'));
      pruned := pruned + coalesce(jsonb_array_length(r->'goneSubscriptionIds'),0);
    end if;
  end loop;
  return jsonb_build_object('sent',sent,'failed',failed,'prunedSubscriptions',pruned);
end $$;

-- 7. Subscriptions are written through the API as the signed-in user.
create or replace function public.st_save_push_subscription(p_actor_id bigint,p_body jsonb) returns public.st_push_subscriptions
language plpgsql security definer set search_path=public,pg_temp as $$
declare row public.st_push_subscriptions;
begin
  if not exists(select 1 from public.st_users where id=p_actor_id and active) then raise exception 'Actor is not active'; end if;
  if coalesce(p_body->>'endpoint','')='' or coalesce(p_body->>'p256dh','')='' or coalesce(p_body->>'auth','')='' then
    raise exception 'Incomplete push subscription';
  end if;
  if length(p_body->>'endpoint')>1000 then raise exception 'Endpoint is too long'; end if;
  insert into public.st_push_subscriptions(user_id,endpoint,p256dh,auth,user_agent)
    values(p_actor_id,p_body->>'endpoint',p_body->>'p256dh',p_body->>'auth',left(coalesce(p_body->>'userAgent',''),300))
    on conflict (endpoint) do update
      set user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,
          user_agent=excluded.user_agent,failures=0
    returning * into row;
  return row;
end $$;

create or replace function public.st_delete_push_subscription(p_actor_id bigint,p_endpoint text) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare removed int;
begin
  delete from public.st_push_subscriptions where user_id=p_actor_id and endpoint=p_endpoint;
  get diagnostics removed = row_count;
  return removed;
end $$;

create or replace function public.st_set_notification_preferences(p_actor_id bigint,p_body jsonb) returns public.st_users
language plpgsql security definer set search_path=public,pg_temp as $$
declare u public.st_users%rowtype;
begin
  update public.st_users
    set notify_push=coalesce((p_body->>'push')::boolean,notify_push),
        notify_email=coalesce((p_body->>'email')::boolean,notify_email)
    where id=p_actor_id and active returning * into u;
  if not found then raise exception 'Actor is not active'; end if;
  return u;
end $$;

revoke all on function public.st_claim_notifications(integer) from public,anon,authenticated;
revoke all on function public.st_report_notifications(jsonb) from public,anon,authenticated;
revoke all on function public.st_save_push_subscription(bigint,jsonb) from public,anon,authenticated;
revoke all on function public.st_delete_push_subscription(bigint,text) from public,anon,authenticated;
revoke all on function public.st_set_notification_preferences(bigint,jsonb) from public,anon,authenticated;
revoke all on function public.st_enqueue_notification() from public,anon,authenticated;
grant execute on function public.st_claim_notifications(integer) to service_role;
grant execute on function public.st_report_notifications(jsonb) to service_role;
grant execute on function public.st_save_push_subscription(bigint,jsonb) to service_role;
grant execute on function public.st_delete_push_subscription(bigint,text) to service_role;
grant execute on function public.st_set_notification_preferences(bigint,jsonb) to service_role;
