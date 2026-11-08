-- Email notifications are removed (owner decision of 2026-11-08). Notifications stay in the app
-- (the list and the badge) and as push. No function, setting or preference refers to email delivery
-- any more; the sent / failed email rows already in the outbox stay as history.

-- A notification is queued for push only.
create or replace function public.st_enqueue_notification() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.st_users%rowtype;
begin
  select * into u from public.st_users where id = new.user_id;
  if not found or not u.active then return new; end if;
  if u.notify_push and exists(select 1 from public.st_push_subscriptions where user_id = new.user_id) then
    insert into public.st_notification_outbox(notification_id, user_id, channel, type, title, message)
      values(new.id, new.user_id, 'PUSH', new.type, new.title, new.message);
  end if;
  return new;
end $$;

-- Anything still waiting to be emailed is dropped instead of being retried against a mailbox that is gone.
delete from public.st_notification_outbox where channel = 'EMAIL' and status in ('PENDING', 'SENDING');

-- The worker claims push rows only.
create or replace function public.st_claim_notifications(p_limit integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare lim int; retries int; claimed jsonb;
begin
  lim := greatest(1, least(100, coalesce(p_limit, (select value_json::text::int from public.st_settings where setting_key = 'notificationBatchSize'), 25)));
  retries := greatest(1, coalesce((select value_json::text::int from public.st_settings where setting_key = 'notificationRetryLimit'), 5));
  with batch as (
    select o.id from public.st_notification_outbox o
    where o.channel = 'PUSH'
      and (o.status = 'PENDING' or (o.status = 'SENDING' and o.claimed_at < now() - interval '10 minutes'))
      and o.attempts < retries
    order by o.created_at
    for update skip locked
    limit lim
  ), claimed_rows as (
    update public.st_notification_outbox o
      set status = 'SENDING', attempts = o.attempts + 1, claimed_at = now()
      where o.id in (select id from batch)
      returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'channel', c.channel, 'type', c.type, 'title', c.title, 'message', c.message,
      'language', coalesce(c.payload_json->>'language', u.language, 'sk'),
      'attempts', c.attempts,
      'recipientName', u.full_name,
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
        from public.st_push_subscriptions s where s.user_id = c.user_id), '[]'::jsonb)
    ) order by c.id), '[]'::jsonb)
    into claimed
    from claimed_rows c join public.st_users u on u.id = c.user_id;
  return jsonb_build_object('rows', claimed);
end $$;
revoke all on function public.st_claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.st_claim_notifications(integer) to service_role;

-- The only preference left is push.
create or replace function public.st_set_notification_preferences(p_actor_id bigint, p_body jsonb) returns public.st_users
language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.st_users%rowtype;
begin
  update public.st_users set notify_push = coalesce((p_body->>'push')::boolean, notify_push)
    where id = p_actor_id and active returning * into u;
  if not found then raise exception 'Actor is not active'; end if;
  return u;
end $$;

delete from public.st_settings where setting_key = 'emailNotificationTypes';
alter table public.st_users drop column if exists notify_email;
