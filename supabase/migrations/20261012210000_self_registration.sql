-- Stage 3: a client can register themselves, and you approve them.
-- Owner decision 5 of 2026-10-12 ("Согласен" to self-registration with approval).
--
-- How it works: the person signs up with Supabase Auth as they do today, then
-- st-api calls st_request_client_account, which creates the st_users row as an
-- OWNER that is NOT active. Nothing is visible to them until an administrator
-- approves it. Approving activates the account and creates the client account;
-- rejecting records why and leaves the sign-in dead.
--
-- Why not create the account active and restrict it later: an inactive st_users
-- row is already refused by context() in st-api ("This account is not activated
-- by Operations"), so the inactive state is the whole gate, enforced in one
-- place that every route already passes through.

create table if not exists public.st_account_requests (
  id bigint generated always as identity primary key,
  user_id bigint not null unique references public.st_users(id) on delete cascade,
  company_name text,
  phone text,
  property_count integer check (property_count is null or property_count between 0 and 1000),
  city text,
  message text check (message is null or length(message) <= 1000),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  decided_by_user_id bigint references public.st_users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists st_account_requests_status_idx on public.st_account_requests(status, created_at desc);
alter table public.st_account_requests enable row level security;
drop policy if exists st_account_requests_backend_only on public.st_account_requests;
create policy st_account_requests_backend_only on public.st_account_requests for all to anon, authenticated using (false) with check (false);
revoke all on public.st_account_requests from anon, authenticated;

-- Self-registration can be turned off without a deployment.
insert into public.st_settings(setting_key, value_json) values ('selfRegistrationOpen','true')
on conflict (setting_key) do nothing;

-- 1. The request. Called with the auth user that has just signed up, so the
--    person is already authenticated — this only asks to be let in.
create or replace function public.st_request_client_account(p_auth_user_id uuid, p_email text, p_body jsonb)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u public.st_users%rowtype; r public.st_account_requests%rowtype; v_name text; v_open boolean;
begin
  v_open := coalesce((select value_json::text::boolean from public.st_settings where setting_key='selfRegistrationOpen'),true);
  if not v_open then raise exception 'Self-registration is closed at the moment'; end if;
  if p_auth_user_id is null then raise exception 'Authentication required'; end if;

  select * into u from public.st_users where auth_user_id=p_auth_user_id;
  if found then
    -- Already known: say where they stand instead of creating a second row.
    select * into r from public.st_account_requests where user_id=u.id;
    return jsonb_build_object('status', case when u.active then 'ACTIVE' else coalesce(r.status,'PENDING') end,
      'role', u.role, 'requestId', r.id);
  end if;

  v_name := nullif(btrim(coalesce(p_body->>'fullName','')),'');
  if v_name is null then raise exception 'Your name is required'; end if;
  if coalesce(btrim(p_email),'')='' then raise exception 'An email address is required'; end if;

  insert into public.st_users(auth_user_id, email, role, full_name, phone, language, active)
    values(p_auth_user_id, lower(btrim(p_email)), 'OWNER', left(v_name,200),
      left(coalesce(btrim(p_body->>'phone'),''),50),
      case when coalesce(p_body->>'language','') in ('ru','sk','uk','en') then p_body->>'language' else 'sk' end,
      false)
    returning * into u;

  insert into public.st_account_requests(user_id, company_name, phone, property_count, city, message)
    values(u.id, nullif(btrim(coalesce(p_body->>'companyName','')),''), nullif(btrim(coalesce(p_body->>'phone','')),''),
      nullif(p_body->>'propertyCount','')::int, nullif(btrim(coalesce(p_body->>'city','')),''),
      nullif(left(btrim(coalesce(p_body->>'message','')),1000),''))
    returning * into r;

  perform public.st_notify_staff('ACCOUNT_REQUEST','New client wants an account',
    coalesce(r.company_name, u.full_name)||' · '||u.email||coalesce(' · '||r.city,''));
  return jsonb_build_object('status','PENDING','role',u.role,'requestId',r.id);
end $$;

-- 2. The decision. Approving activates the account and gives it a client
--    account; rejecting keeps the row so the same person cannot queue twice and
--    so the reason is on record.
create or replace function public.st_decide_client_account(p_actor_id bigint, p_request_id bigint, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.st_users%rowtype; u public.st_users%rowtype; r public.st_account_requests%rowtype; ca public.st_client_accounts%rowtype;
begin
  select * into strict a from public.st_users where id=p_actor_id and active;
  if a.role not in ('ADMIN','OPERATIONS_MANAGER') then raise exception 'Forbidden'; end if;
  -- Letting someone in is an account decision, so it is the administrator's.
  if a.role='OPERATIONS_MANAGER' then raise exception 'Forbidden: accounts require administrator'; end if;
  select * into strict r from public.st_account_requests where id=p_request_id for update;
  if r.status <> 'PENDING' then raise exception 'This request was already decided (%)', r.status; end if;
  select * into strict u from public.st_users where id=r.user_id for update;

  if p_approve then
    update public.st_users set active=true where id=u.id returning * into u;
    select * into ca from public.st_client_accounts where user_id=u.id;
    if not found then
      insert into public.st_client_accounts(user_id, account_type, company_name)
        values(u.id,'OWNER', r.company_name) returning * into ca;
    end if;
    insert into public.st_notifications(user_id,type,title,message)
      values(u.id,'ACCOUNT_APPROVED','Your account is ready','You can add your properties and book a cleaning.');
  else
    update public.st_users set active=false where id=u.id;
  end if;

  update public.st_account_requests
    set status=case when p_approve then 'APPROVED' else 'REJECTED' end,
        decided_by_user_id=a.id, decided_at=now(),
        decision_note=nullif(left(btrim(coalesce(p_note,'')),500),'')
    where id=r.id returning * into r;

  return jsonb_build_object('status',r.status,'userId',u.id,'clientId',ca.id,
    'email',u.email,'fullName',u.full_name);
end $$;

create or replace function public.st_account_requests_list(p_actor_id bigint, p_status text default 'PENDING') returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a public.st_users%rowtype; v_status text;
begin
  select * into strict a from public.st_users where id=p_actor_id and active;
  if a.role <> 'ADMIN' then raise exception 'Forbidden: accounts require administrator'; end if;
  v_status := upper(coalesce(nullif(btrim(p_status),''),'PENDING'));
  if v_status not in ('PENDING','APPROVED','REJECTED','ALL') then raise exception 'Unknown status'; end if;
  return jsonb_build_object('requests', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',r.id,'status',r.status,'created_at',r.created_at,
      'full_name',u.full_name,'email',u.email,'phone',coalesce(r.phone,u.phone),
      'company_name',r.company_name,'city',r.city,'property_count',r.property_count,
      'message',r.message,'language',u.language,
      'decided_at',r.decided_at,'decision_note',r.decision_note,
      'decided_by',(select full_name from public.st_users d where d.id=r.decided_by_user_id)
    ) order by r.created_at desc)
    from public.st_account_requests r join public.st_users u on u.id=r.user_id
    where v_status='ALL' or r.status=v_status),'[]'::jsonb));
end $$;

revoke all on function public.st_request_client_account(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.st_decide_client_account(bigint,bigint,boolean,text) from public,anon,authenticated;
revoke all on function public.st_account_requests_list(bigint,text) from public,anon,authenticated;
grant execute on function public.st_request_client_account(uuid,text,jsonb) to service_role;
grant execute on function public.st_decide_client_account(bigint,bigint,boolean,text) to service_role;
grant execute on function public.st_account_requests_list(bigint,text) to service_role;
