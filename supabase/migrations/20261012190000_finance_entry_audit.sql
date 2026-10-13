-- Stage 2, fix 25: finance entries become editable — without losing history.
--
-- Until now a manual income/expense entry could only be created or hard
-- deleted, and the delete left no trace: a wrong number had to be removed and
-- re-entered, and nothing recorded that it ever existed. AGENTS.md is explicit
-- that finance history must be preserved and recorded payments must not be
-- silently rewritten, so editing is allowed only through a function that writes
-- the before and after of every change.
--
-- What is NOT touched: st_settlements. Recorded payments to clients and
-- cleaners stay append-only; a mistake there is corrected by its counter-entry
-- (CLIENT_REFUND / CLEANER_RETURN), which the settlement command already does.

create table if not exists public.st_finance_entry_audit (
  id bigint generated always as identity primary key,
  entry_id bigint not null,
  action text not null check (action in ('CREATE','UPDATE','DELETE')),
  before_json jsonb,
  after_json jsonb,
  reason text,
  actor_user_id bigint references public.st_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists st_finance_entry_audit_entry_idx on public.st_finance_entry_audit(entry_id, id desc);
alter table public.st_finance_entry_audit enable row level security;
drop policy if exists st_finance_entry_audit_backend_only on public.st_finance_entry_audit;
create policy st_finance_entry_audit_backend_only on public.st_finance_entry_audit for all to anon, authenticated using (false) with check (false);
revoke all on public.st_finance_entry_audit from anon, authenticated;

-- The entry id survives its row on purpose: the audit row of a deleted entry
-- must stay readable, so there is no foreign key to st_financial_entries.

create or replace function public.st_save_finance_entry(p_actor_id bigint, p_body jsonb) returns public.st_financial_entries
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  u public.st_users%rowtype; e public.st_financial_entries%rowtype; before_row public.st_financial_entries%rowtype;
  v_id bigint; v_amount numeric; v_type text; v_date date;
begin
  select * into strict u from public.st_users where id=p_actor_id and active;
  -- Finance belongs to the administrator; an operations manager never sees money.
  if u.role <> 'ADMIN' then raise exception 'Forbidden: finance requires administrator'; end if;

  v_type := upper(coalesce(p_body->>'entryType',''));
  if v_type not in ('INCOME','EXPENSE') then raise exception 'Entry type must be INCOME or EXPENSE'; end if;
  v_amount := (p_body->>'amount')::numeric;
  if v_amount is null or v_amount <= 0 then raise exception 'A positive amount is required'; end if;
  v_date := coalesce((p_body->>'entryDate')::date,(now() at time zone 'Europe/Bratislava')::date);

  v_id := nullif(p_body->>'id','')::bigint;
  if v_id is not null then
    select * into strict before_row from public.st_financial_entries where id=v_id for update;
    update public.st_financial_entries set
      entry_date=v_date, entry_type=v_type,
      category=coalesce(nullif(btrim(p_body->>'category'),''),'OTHER'),
      amount=v_amount,
      description=nullif(left(btrim(coalesce(p_body->>'description','')),500),''),
      client_id=nullif(p_body->>'clientId','')::bigint,
      object_id=nullif(p_body->>'objectId','')::bigint,
      job_id=nullif(p_body->>'jobId','')::bigint
      where id=v_id returning * into e;
    insert into public.st_finance_entry_audit(entry_id,action,before_json,after_json,reason,actor_user_id)
      values(e.id,'UPDATE',to_jsonb(before_row),to_jsonb(e),nullif(left(btrim(coalesce(p_body->>'reason','')),300),''),u.id);
  else
    insert into public.st_financial_entries(entry_date,entry_type,category,amount,description,client_id,object_id,job_id,created_by_user_id)
      values(v_date,v_type,coalesce(nullif(btrim(p_body->>'category'),''),'OTHER'),v_amount,
        nullif(left(btrim(coalesce(p_body->>'description','')),500),''),
        nullif(p_body->>'clientId','')::bigint,nullif(p_body->>'objectId','')::bigint,nullif(p_body->>'jobId','')::bigint,u.id)
      returning * into e;
    insert into public.st_finance_entry_audit(entry_id,action,before_json,after_json,actor_user_id)
      values(e.id,'CREATE',null,to_jsonb(e),u.id);
  end if;
  return e;
end $$;

create or replace function public.st_delete_finance_entry(p_actor_id bigint, p_id bigint, p_reason text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare u public.st_users%rowtype; e public.st_financial_entries%rowtype;
begin
  select * into strict u from public.st_users where id=p_actor_id and active;
  if u.role <> 'ADMIN' then raise exception 'Forbidden: finance requires administrator'; end if;
  select * into e from public.st_financial_entries where id=p_id for update;
  if not found then raise exception 'Finance entry not found'; end if;
  -- The whole row is kept in the audit before it goes, so a deleted entry can
  -- still be read back and re-entered.
  insert into public.st_finance_entry_audit(entry_id,action,before_json,after_json,reason,actor_user_id)
    values(e.id,'DELETE',to_jsonb(e),null,nullif(left(btrim(coalesce(p_reason,'')),300),''),u.id);
  delete from public.st_financial_entries where id=p_id;
  return jsonb_build_object('deleted',1,'entryId',p_id);
end $$;

create or replace function public.st_finance_entry_history(p_actor_id bigint, p_entry_id bigint) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u public.st_users%rowtype;
begin
  select * into strict u from public.st_users where id=p_actor_id and active;
  if u.role <> 'ADMIN' then raise exception 'Forbidden: finance requires administrator'; end if;
  return jsonb_build_object('history', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',a.id,'action',a.action,'reason',a.reason,'created_at',a.created_at,
      'actor',(select full_name from public.st_users where id=a.actor_user_id),
      'before',a.before_json,'after',a.after_json) order by a.id desc)
    from public.st_finance_entry_audit a where a.entry_id=p_entry_id),'[]'::jsonb));
end $$;

-- Fix 25, second half: a reference-photo caption can be corrected in place.
create or replace function public.st_update_photo_caption(p_actor_id bigint, p_object_id bigint, p_photo_id bigint, p_caption text)
returns public.st_object_photos
language plpgsql security definer set search_path=public,pg_temp as $$
declare u public.st_users%rowtype; p public.st_object_photos%rowtype; ca public.st_client_accounts%rowtype;
begin
  select * into strict u from public.st_users where id=p_actor_id and active;
  select * into p from public.st_object_photos where id=p_photo_id and object_id=p_object_id;
  if not found then raise exception 'Photo not found'; end if;
  -- The same people who may add or delete a photo may rename it: operations,
  -- and the owner of the property. A property manager may look, not edit.
  if u.role in ('ADMIN','OPERATIONS_MANAGER') then
    null;
  elsif u.role='OWNER' then
    select * into ca from public.st_client_accounts where user_id=u.id;
    if not found or not exists(select 1 from public.st_objects o where o.id=p_object_id and o.client_id=ca.id) then raise exception 'Forbidden'; end if;
  else
    raise exception 'Forbidden';
  end if;
  update public.st_object_photos set caption=left(btrim(coalesce(p_caption,'')),300) where id=p_photo_id returning * into p;
  return p;
end $$;

revoke all on function public.st_save_finance_entry(bigint,jsonb) from public,anon,authenticated;
revoke all on function public.st_delete_finance_entry(bigint,bigint,text) from public,anon,authenticated;
revoke all on function public.st_finance_entry_history(bigint,bigint) from public,anon,authenticated;
revoke all on function public.st_update_photo_caption(bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.st_save_finance_entry(bigint,jsonb) to service_role;
grant execute on function public.st_delete_finance_entry(bigint,bigint,text) to service_role;
grant execute on function public.st_finance_entry_history(bigint,bigint) to service_role;
grant execute on function public.st_update_photo_caption(bigint,bigint,bigint,text) to service_role;
