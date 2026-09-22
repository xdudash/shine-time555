-- Operations assignments are queried for audit/history as the manager
-- portfolio grows. Cover the FK to avoid scans during user-account joins.
create index if not exists st_manager_properties_assigned_by_user_idx
  on public.st_manager_properties (assigned_by_user_id)
  where assigned_by_user_id is not null;
