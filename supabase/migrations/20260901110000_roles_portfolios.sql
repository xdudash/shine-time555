-- Distinguish the internal dispatcher from an external property manager.
alter table public.st_users drop constraint if exists st_users_role_check;
alter table public.st_users add constraint st_users_role_check
  check (role in ('ADMIN', 'OPERATIONS_MANAGER', 'CLEANER', 'OWNER', 'PROPERTY_MANAGER'));

alter table public.st_client_accounts drop constraint if exists st_client_accounts_account_type_check;
alter table public.st_client_accounts add constraint st_client_accounts_account_type_check
  check (account_type in ('OWNER', 'PROPERTY_MANAGER'));

update public.st_users set role = 'PROPERTY_MANAGER' where role = 'MANAGER';
update public.st_client_accounts set account_type = 'PROPERTY_MANAGER' where account_type = 'MANAGER';

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

alter table public.st_manager_properties enable row level security;
alter table public.st_user_permissions enable row level security;
