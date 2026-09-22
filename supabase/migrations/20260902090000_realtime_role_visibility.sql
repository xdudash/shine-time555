-- Keep Realtime visibility consistent with the server-side role model.
-- The Edge Function remains the only write path; this only permits each
-- signed-in role to receive st_jobs changes that it is already allowed to see.

alter table public.st_jobs enable row level security;

drop policy if exists st_jobs_realtime_read on public.st_jobs;
create policy st_jobs_realtime_read on public.st_jobs for select to authenticated using (
  exists (
    select 1
    from public.st_users u
    where u.auth_user_id = (select auth.uid())
      and u.active
      and (
        u.role in ('ADMIN', 'OPERATIONS_MANAGER')
        or (
          u.role = 'CLEANER'
          and exists (
            select 1
            from public.st_cleaners c
            where c.user_id = u.id
              and c.active
              and (
                st_jobs.assigned_cleaner_id = c.id
                or (
                  st_jobs.assigned_cleaner_id is null
                  and st_jobs.marketplace_visible
                  and st_jobs.status in ('UNASSIGNED', 'AT_RISK', 'RESCUE')
                )
              )
          )
        )
        or (
          u.role = 'OWNER'
          and exists (
            select 1
            from public.st_client_accounts ca
            where ca.user_id = u.id
              and st_jobs.client_id = ca.id
          )
        )
        or (
          u.role = 'PROPERTY_MANAGER'
          and exists (
            select 1
            from public.st_client_accounts ca
            join public.st_manager_properties mp on mp.manager_client_id = ca.id
            where ca.user_id = u.id
              and mp.object_id = st_jobs.object_id
          )
        )
      )
  )
);
