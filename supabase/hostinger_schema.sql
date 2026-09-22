-- Shine Time v4 data model for the Hostinger shell.
-- Apply this once to the connected Supabase project before uploading the ZIP.
-- The browser never receives the service-role key. All writes use st-api.

create extension if not exists pgcrypto;

create table if not exists public.st_users (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null check (role in ('ADMIN', 'OPERATIONS_MANAGER', 'CLEANER', 'OWNER', 'PROPERTY_MANAGER')),
  full_name text not null,
  phone text not null default '',
  language text not null default 'ru' check (language in ('ru', 'sk', 'uk', 'en')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.st_cleaners (
  id bigint generated always as identity primary key,
  user_id bigint not null unique references public.st_users(id) on delete cascade,
  mode text not null default 'FLEX' check (mode in ('FLEX', 'GUARANTEE')),
  reliability_score numeric(5,2) not null default 95 check (reliability_score >= 0 and reliability_score <= 100),
  rating numeric(3,2) not null default 5 check (rating >= 0 and rating <= 5),
  transport text not null default 'PUBLIC' check (transport in ('CAR', 'PUBLIC', 'WALKING')),
  preferred_zones jsonb not null default '[]'::jsonb,
  max_jobs_day integer not null default 5 check (max_jobs_day between 1 and 20),
  active boolean not null default true,
  last_lat double precision,
  last_lng double precision,
  last_location_at timestamptz,
  completed_jobs integer not null default 0,
  reclean_rate numeric(5,2) not null default 0,
  cancellation_rate numeric(5,2) not null default 0,
  avg_delay_minutes numeric(8,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.st_client_accounts (
  id bigint generated always as identity primary key,
  user_id bigint not null unique references public.st_users(id) on delete cascade,
  account_type text not null default 'OWNER' check (account_type in ('OWNER', 'PROPERTY_MANAGER')),
  company_name text,
  billing_name text,
  ico text,
  dic text,
  ic_dph text,
  billing_address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.st_settings (
  setting_key text primary key,
  value_json jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.st_bootstrap_state (
  id smallint primary key check (id = 1),
  initialized_auth_user_id uuid,
  initialized_at timestamptz
);
insert into public.st_bootstrap_state(id) values (1) on conflict (id) do nothing;

create table if not exists public.st_objects (
  id bigint generated always as identity primary key,
  client_id bigint references public.st_client_accounts(id) on delete set null,
  code text not null unique,
  name text not null,
  address text not null,
  zone text not null default 'Bratislava',
  apartment_type text not null default 'Apartment',
  bedrooms integer not null default 1 check (bedrooms >= 0),
  bathrooms integer not null default 1 check (bathrooms >= 0),
  lat double precision,
  lng double precision,
  checkout_time time not null default '10:00',
  deadline_time time not null default '15:00',
  duration_minutes integer not null default 120 check (duration_minutes between 15 and 1440),
  payout numeric(12,2) not null default 0,
  client_price numeric(12,2) not null default 0,
  active boolean not null default true,
  approval_status text not null default 'APPROVED' check (approval_status in ('PENDING', 'APPROVED', 'REJECTED')),
  access_instructions text,
  key_instructions text,
  parking text,
  linen_location text,
  supplies_location text,
  wifi text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.st_manager_properties (
  id bigint generated always as identity primary key,
  manager_client_id bigint not null references public.st_client_accounts(id) on delete cascade,
  object_id bigint not null references public.st_objects(id) on delete cascade,
  assigned_by_user_id bigint references public.st_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (manager_client_id, object_id)
);

create index if not exists st_manager_properties_manager_idx on public.st_manager_properties(manager_client_id);
create index if not exists st_manager_properties_object_idx on public.st_manager_properties(object_id);

create table if not exists public.st_user_permissions (
  user_id bigint primary key references public.st_users(id) on delete cascade,
  manage_jobs boolean not null default true,
  manage_objects boolean not null default true,
  manage_people boolean not null default false,
  view_finance boolean not null default false,
  manage_finance boolean not null default false,
  manage_settings boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.st_checklist_items (
  id bigint generated always as identity primary key,
  object_id bigint not null references public.st_objects(id) on delete cascade,
  label text not null,
  required boolean not null default true,
  photo_required boolean not null default false,
  photo_category text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.st_jobs (
  id bigint generated always as identity primary key,
  object_id bigint not null references public.st_objects(id) on delete restrict,
  client_id bigint references public.st_client_accounts(id) on delete set null,
  service_date date not null,
  earliest_start time not null default '10:00',
  deadline time not null default '15:00',
  duration_minutes integer not null default 120 check (duration_minutes between 15 and 1440),
  payout numeric(12,2) not null default 0,
  client_price numeric(12,2) not null default 0,
  bonus numeric(12,2) not null default 0,
  extra_revenue numeric(12,2) not null default 0,
  extra_cost numeric(12,2) not null default 0,
  financial_status text not null default 'PENDING' check (financial_status in ('PENDING', 'INVOICED', 'PAID')),
  booking_source text not null default 'ADMIN',
  created_by_user_id bigint references public.st_users(id) on delete set null,
  assigned_cleaner_id bigint references public.st_cleaners(id) on delete set null,
  status text not null default 'UNASSIGNED' check (status in ('UNASSIGNED', 'OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'CLEANING', 'COMPLETED', 'AT_RISK', 'RESCUE', 'CANCELLED')),
  marketplace_visible boolean not null default true,
  planned_start time,
  eta time,
  accepted_at timestamptz,
  actual_checkin timestamptz,
  actual_start timestamptz,
  completed_at timestamptz,
  checkin_lat double precision,
  checkin_lng double precision,
  risk_score integer not null default 0,
  risk_level text not null default 'GREEN' check (risk_level in ('GREEN', 'ORANGE', 'RED')),
  risk_reasons jsonb not null default '[]'::jsonb,
  rescue_state text not null default 'NONE' check (rescue_state in ('NONE', 'ACTIVE', 'ASSIGNED')),
  issue_flag boolean not null default false,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (object_id, service_date)
);

create table if not exists public.st_job_checklist (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.st_jobs(id) on delete cascade,
  checklist_item_id bigint references public.st_checklist_items(id) on delete set null,
  label text not null,
  required boolean not null default true,
  photo_required boolean not null default false,
  photo_category text,
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by_user_id bigint references public.st_users(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.st_job_photos (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.st_jobs(id) on delete cascade,
  cleaner_id bigint references public.st_cleaners(id) on delete set null,
  checklist_item_id bigint references public.st_job_checklist(id) on delete set null,
  category text not null,
  storage_path text not null,
  file_name text not null,
  mime text not null default 'image/jpeg',
  file_size bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.st_issues (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.st_jobs(id) on delete cascade,
  cleaner_id bigint references public.st_cleaners(id) on delete set null,
  type text not null,
  description text,
  priority text not null default 'NORMAL' check (priority in ('NORMAL', 'HIGH')),
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  photos_json jsonb not null default '[]'::jsonb,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.st_notifications (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.st_users(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.st_cleaner_availability (
  id bigint generated always as identity primary key,
  cleaner_id bigint not null references public.st_cleaners(id) on delete cascade,
  service_date date not null,
  online boolean not null default false,
  from_time time not null default '10:00',
  to_time time not null default '15:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cleaner_id, service_date)
);

create table if not exists public.st_job_events (
  id bigint generated always as identity primary key,
  job_id bigint references public.st_jobs(id) on delete cascade,
  user_id bigint references public.st_users(id) on delete set null,
  event_type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.st_financial_entries (
  id bigint generated always as identity primary key,
  entry_date date not null,
  entry_type text not null check (entry_type in ('INCOME', 'EXPENSE')),
  category text not null default 'OTHER',
  amount numeric(12,2) not null check (amount > 0),
  description text,
  client_id bigint references public.st_client_accounts(id) on delete set null,
  object_id bigint references public.st_objects(id) on delete set null,
  job_id bigint references public.st_jobs(id) on delete set null,
  created_by_user_id bigint references public.st_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists st_jobs_date_status_idx on public.st_jobs(service_date, status, planned_start);
create index if not exists st_jobs_cleaner_date_idx on public.st_jobs(assigned_cleaner_id, service_date);
create index if not exists st_jobs_client_date_idx on public.st_jobs(client_id, service_date);
create index if not exists st_jobs_created_by_idx on public.st_jobs(created_by_user_id);
create index if not exists st_objects_client_idx on public.st_objects(client_id, approval_status);
create index if not exists st_checklist_items_object_idx on public.st_checklist_items(object_id);
create index if not exists st_job_checklist_job_idx on public.st_job_checklist(job_id);
create index if not exists st_job_checklist_item_idx on public.st_job_checklist(checklist_item_id);
create index if not exists st_job_checklist_completed_by_idx on public.st_job_checklist(completed_by_user_id);
create index if not exists st_notifications_user_idx on public.st_notifications(user_id, read_at, created_at desc);
create index if not exists st_events_job_idx on public.st_job_events(job_id, created_at desc);
create index if not exists st_events_user_idx on public.st_job_events(user_id);
create index if not exists st_photos_job_idx on public.st_job_photos(job_id, created_at);
create index if not exists st_photos_cleaner_idx on public.st_job_photos(cleaner_id);
create index if not exists st_photos_checklist_idx on public.st_job_photos(checklist_item_id);
create index if not exists st_issues_job_idx on public.st_issues(job_id, status);
create index if not exists st_issues_cleaner_idx on public.st_issues(cleaner_id);
create index if not exists st_finance_date_idx on public.st_financial_entries(entry_date);
create index if not exists st_finance_client_idx on public.st_financial_entries(client_id, entry_date);
create index if not exists st_finance_object_idx on public.st_financial_entries(object_id, entry_date);
create index if not exists st_finance_job_idx on public.st_financial_entries(job_id);
create index if not exists st_finance_created_by_idx on public.st_financial_entries(created_by_user_id);

create or replace function public.st_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists st_users_touch on public.st_users;
create trigger st_users_touch before update on public.st_users for each row execute function public.st_touch_updated_at();
drop trigger if exists st_cleaners_touch on public.st_cleaners;
create trigger st_cleaners_touch before update on public.st_cleaners for each row execute function public.st_touch_updated_at();
drop trigger if exists st_clients_touch on public.st_client_accounts;
create trigger st_clients_touch before update on public.st_client_accounts for each row execute function public.st_touch_updated_at();
drop trigger if exists st_objects_touch on public.st_objects;
create trigger st_objects_touch before update on public.st_objects for each row execute function public.st_touch_updated_at();
drop trigger if exists st_jobs_touch on public.st_jobs;
create trigger st_jobs_touch before update on public.st_jobs for each row execute function public.st_touch_updated_at();
drop trigger if exists st_availability_touch on public.st_cleaner_availability;
create trigger st_availability_touch before update on public.st_cleaner_availability for each row execute function public.st_touch_updated_at();

insert into public.st_settings(setting_key, value_json) values
  ('windowStart', '"10:00"'), ('windowEnd', '"15:00"'), ('travelBuffer', '15'),
  ('sameZoneTravelBuffer', '10'), ('safetyBuffer', '10'), ('rescueStart', '"13:30"'),
  ('surge2Start', '"11:30"'), ('surge4Start', '"12:30"'), ('surge6Start', '"13:30"'),
  ('checkinRadiusMeters', '250'), ('reserveTargetPct', '20'),
  ('cleanerCancellationCutoffMinutes', '90'), ('companyName', '"Shine Time Operations"'),
  ('timezone', '"Europe/Bratislava"'), ('clientBookingStepMinutes', '30'),
  ('clientCancellationCutoffHours', '12'), ('defaultLanguage', '"ru"')
on conflict (setting_key) do nothing;

drop policy if exists st_jobs_realtime_read on public.st_jobs;
drop function if exists public.st_bootstrap_admin(uuid, text, text, text, text);
drop function if exists public.st_visible_job(bigint);

alter table public.st_users enable row level security;
alter table public.st_cleaners enable row level security;
alter table public.st_client_accounts enable row level security;
alter table public.st_settings enable row level security;
alter table public.st_bootstrap_state enable row level security;
alter table public.st_objects enable row level security;
alter table public.st_checklist_items enable row level security;
alter table public.st_jobs enable row level security;
alter table public.st_job_checklist enable row level security;
alter table public.st_job_photos enable row level security;
alter table public.st_issues enable row level security;
alter table public.st_notifications enable row level security;
alter table public.st_cleaner_availability enable row level security;
alter table public.st_job_events enable row level security;
alter table public.st_financial_entries enable row level security;
alter table public.st_manager_properties enable row level security;
alter table public.st_user_permissions enable row level security;

drop policy if exists st_users_self_read on public.st_users;
create policy st_users_self_read on public.st_users for select to authenticated using ((select auth.uid()) = auth_user_id);
drop policy if exists st_cleaners_self_read on public.st_cleaners;
create policy st_cleaners_self_read on public.st_cleaners for select to authenticated
using (exists (select 1 from public.st_users u where u.id = st_cleaners.user_id and u.auth_user_id = (select auth.uid())));
drop policy if exists st_clients_self_read on public.st_client_accounts;
create policy st_clients_self_read on public.st_client_accounts for select to authenticated
using (exists (select 1 from public.st_users u where u.id = st_client_accounts.user_id and u.auth_user_id = (select auth.uid())));
drop policy if exists st_jobs_realtime_read on public.st_jobs;
create policy st_jobs_realtime_read on public.st_jobs for select to authenticated using (
  exists (
    select 1 from public.st_users u
    where u.auth_user_id = (select auth.uid()) and u.active and (
      u.role in ('ADMIN','OPERATIONS_MANAGER')
      or (u.role = 'CLEANER' and exists (
        select 1 from public.st_cleaners c
        where c.user_id = u.id and c.active and (
          st_jobs.assigned_cleaner_id = c.id
          or (st_jobs.assigned_cleaner_id is null and st_jobs.marketplace_visible and st_jobs.status in ('UNASSIGNED','AT_RISK','RESCUE'))
        )
      ))
      or (u.role = 'OWNER' and exists (
        select 1 from public.st_client_accounts ca where ca.user_id = u.id and st_jobs.client_id = ca.id
      ))
      or (u.role = 'PROPERTY_MANAGER' and exists (
        select 1
        from public.st_client_accounts ca
        join public.st_manager_properties mp on mp.manager_client_id = ca.id
        where ca.user_id = u.id and mp.object_id = st_jobs.object_id
      ))
    )
  )
);

drop policy if exists st_checklist_items_backend_only on public.st_checklist_items;
create policy st_checklist_items_backend_only on public.st_checklist_items for all to anon, authenticated using (false) with check (false);
drop policy if exists st_availability_backend_only on public.st_cleaner_availability;
create policy st_availability_backend_only on public.st_cleaner_availability for all to anon, authenticated using (false) with check (false);
drop policy if exists st_financial_entries_backend_only on public.st_financial_entries;
create policy st_financial_entries_backend_only on public.st_financial_entries for all to anon, authenticated using (false) with check (false);
drop policy if exists st_issues_backend_only on public.st_issues;
create policy st_issues_backend_only on public.st_issues for all to anon, authenticated using (false) with check (false);
drop policy if exists st_job_checklist_backend_only on public.st_job_checklist;
create policy st_job_checklist_backend_only on public.st_job_checklist for all to anon, authenticated using (false) with check (false);
drop policy if exists st_job_events_backend_only on public.st_job_events;
create policy st_job_events_backend_only on public.st_job_events for all to anon, authenticated using (false) with check (false);

drop policy if exists st_manager_properties_backend_only on public.st_manager_properties;
create policy st_manager_properties_backend_only on public.st_manager_properties for all to anon, authenticated using (false) with check (false);
drop policy if exists st_user_permissions_backend_only on public.st_user_permissions;
create policy st_user_permissions_backend_only on public.st_user_permissions for all to anon, authenticated using (false) with check (false);
drop policy if exists st_job_photos_backend_only on public.st_job_photos;
create policy st_job_photos_backend_only on public.st_job_photos for all to anon, authenticated using (false) with check (false);
drop policy if exists st_notifications_backend_only on public.st_notifications;
create policy st_notifications_backend_only on public.st_notifications for all to anon, authenticated using (false) with check (false);
drop policy if exists st_objects_backend_only on public.st_objects;
create policy st_objects_backend_only on public.st_objects for all to anon, authenticated using (false) with check (false);
drop policy if exists st_settings_backend_only on public.st_settings;
create policy st_settings_backend_only on public.st_settings for all to anon, authenticated using (false) with check (false);
drop policy if exists st_bootstrap_state_backend_only on public.st_bootstrap_state;
create policy st_bootstrap_state_backend_only on public.st_bootstrap_state for all to anon, authenticated using (false) with check (false);

revoke all on table
  public.st_users,
  public.st_cleaners,
  public.st_client_accounts,
  public.st_settings,
  public.st_bootstrap_state,
  public.st_objects,
  public.st_checklist_items,
  public.st_jobs,
  public.st_job_checklist,
  public.st_job_photos,
  public.st_issues,
  public.st_notifications,
  public.st_cleaner_availability,
  public.st_job_events,
  public.st_financial_entries
from anon, authenticated;
grant select on public.st_users, public.st_cleaners, public.st_client_accounts, public.st_jobs to authenticated;

insert into storage.buckets(id, name, public) values ('st-cleaning-media', 'st-cleaning-media', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'st_jobs'
  ) then
    alter publication supabase_realtime add table public.st_jobs;
  end if;
end;
$$;

-- Marketplace claims are deliberately atomic: a cleaner cannot overbook by
-- pressing Accept in two tabs at the same time. The Edge Function is the only
-- caller (service_role); browser roles are explicitly denied.
create index if not exists st_jobs_cleaner_day_active_idx
  on public.st_jobs (assigned_cleaner_id, service_date, planned_start)
  where status <> 'CANCELLED';

create index if not exists st_manager_properties_assigned_by_user_idx
  on public.st_manager_properties (assigned_by_user_id)
  where assigned_by_user_id is not null;

create or replace function public.st_claim_marketplace_job(
  p_cleaner_id bigint,
  p_job_id bigint,
  p_now_time time without time zone,
  p_window_end time without time zone,
  p_safety_buffer integer,
  p_travel_buffer integer
)
returns public.st_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.st_jobs%rowtype;
  v_cleaner public.st_cleaners%rowtype;
  v_availability public.st_cleaner_availability%rowtype;
  v_active_jobs integer;
  v_start time without time zone;
  v_finish time without time zone;
begin
  perform pg_advisory_xact_lock(p_cleaner_id);
  select * into v_job from public.st_jobs where id = p_job_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Job not found'; end if;
  if not v_job.marketplace_visible or v_job.assigned_cleaner_id is not null or v_job.status not in ('UNASSIGNED', 'AT_RISK', 'RESCUE') then
    raise exception using errcode = 'P0001', message = 'This job was already accepted by another cleaner';
  end if;
  select * into v_cleaner from public.st_cleaners where id = p_cleaner_id and active for share;
  if not found then raise exception using errcode = 'P0001', message = 'Cleaner is not active'; end if;
  select * into v_availability from public.st_cleaner_availability where cleaner_id = p_cleaner_id and service_date = v_job.service_date;
  if not found or not coalesce(v_availability.online, false) then raise exception using errcode = 'P0001', message = 'Cleaner is offline'; end if;
  v_start := coalesce(v_job.planned_start, v_job.earliest_start);
  v_finish := v_start + make_interval(mins => greatest(0, v_job.duration_minutes) + greatest(0, p_safety_buffer));
  if v_start < p_now_time then raise exception using errcode = 'P0001', message = 'Job start has already passed'; end if;
  if v_start < v_availability.from_time or v_finish > least(v_availability.to_time, p_window_end) then raise exception using errcode = 'P0001', message = 'Outside cleaner availability'; end if;
  select count(*) into v_active_jobs from public.st_jobs j where j.assigned_cleaner_id = p_cleaner_id and j.service_date = v_job.service_date and j.status <> 'CANCELLED';
  if v_active_jobs >= v_cleaner.max_jobs_day then raise exception using errcode = 'P0001', message = 'Daily limit reached'; end if;
  if exists (select 1 from public.st_jobs j where j.assigned_cleaner_id = p_cleaner_id and j.service_date = v_job.service_date and j.status <> 'CANCELLED' and v_start < coalesce(j.planned_start, j.earliest_start) + make_interval(mins => greatest(0, j.duration_minutes) + greatest(0, p_safety_buffer) + greatest(0, p_travel_buffer)) and v_finish + make_interval(mins => greatest(0, p_travel_buffer)) > coalesce(j.planned_start, j.earliest_start)) then
    raise exception using errcode = 'P0001', message = 'Conflicts with an assigned job';
  end if;
  update public.st_jobs set assigned_cleaner_id = p_cleaner_id, status = 'ACCEPTED', accepted_at = now(), marketplace_visible = false, rescue_state = 'NONE' where id = p_job_id returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.st_claim_marketplace_job(bigint, bigint, time, time, integer, integer) from public, anon, authenticated;
grant execute on function public.st_claim_marketplace_job(bigint, bigint, time, time, integer, integer) to service_role;
