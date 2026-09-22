-- Safe follow-up for an already applied hostinger_schema.sql.
create table if not exists public.st_bootstrap_state (
  id smallint primary key check (id = 1),
  initialized_auth_user_id uuid,
  initialized_at timestamptz
);
insert into public.st_bootstrap_state(id) values (1) on conflict (id) do nothing;

drop policy if exists st_jobs_realtime_read on public.st_jobs;
drop function if exists public.st_bootstrap_admin(uuid, text, text, text, text);
drop function if exists public.st_visible_job(bigint);

alter table public.st_bootstrap_state enable row level security;
drop policy if exists st_users_self_read on public.st_users;
create policy st_users_self_read on public.st_users for select to authenticated using ((select auth.uid()) = auth_user_id);
drop policy if exists st_cleaners_self_read on public.st_cleaners;
create policy st_cleaners_self_read on public.st_cleaners for select to authenticated
using (exists (select 1 from public.st_users u where u.id = st_cleaners.user_id and u.auth_user_id = (select auth.uid())));
drop policy if exists st_clients_self_read on public.st_client_accounts;
create policy st_clients_self_read on public.st_client_accounts for select to authenticated
using (exists (select 1 from public.st_users u where u.id = st_client_accounts.user_id and u.auth_user_id = (select auth.uid())));
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

revoke all on table public.st_bootstrap_state from anon, authenticated;
grant select on public.st_users, public.st_cleaners, public.st_client_accounts, public.st_jobs to authenticated;
