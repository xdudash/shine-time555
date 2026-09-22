-- Aggregate in PostgreSQL; the REST row limit must never change financial totals.
create function st_finance_report(p_actor_id bigint,p_month text,p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare first_day date;last_day date;answer jsonb;
begin
 if not exists(select 1 from st_users where id=p_actor_id and active and role='ADMIN') then raise exception 'Forbidden';end if;
 if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid month';end if;
 first_day:=(p_month||'-01')::date;last_day:=(first_day+interval '1 month')::date;
 with source as materialized (
  select service_date d,client_id,object_id,client_price+extra_revenue revenue,payout+bonus+extra_cost cost,1 jobs,
   client_price+extra_revenue cleaning,payout,bonus,extra_cost,0::numeric income,0::numeric expense
  from st_jobs where status='COMPLETED' and service_date>=first_day-interval '11 months' and service_date<last_day
  union all
  select entry_date,client_id,object_id,case when entry_type='INCOME' then amount else 0 end,case when entry_type='EXPENSE' then amount else 0 end,0,
   0,0,0,0,case when entry_type='INCOME' then amount else 0 end,case when entry_type='EXPENSE' then amount else 0 end
  from st_financial_entries where entry_date>=first_day-interval '11 months' and entry_date<last_day
 ), month_rows as materialized (select * from source where d>=first_day), totals as (
  select coalesce(sum(revenue),0) revenue,coalesce(sum(cost),0) cost,coalesce(sum(jobs),0) jobs,
   coalesce(sum(cleaning),0) cleaning,coalesce(sum(payout),0) payout,coalesce(sum(bonus),0) bonus,coalesce(sum(extra_cost),0) extras,
   coalesce(sum(income),0) income,coalesce(sum(expense),0) expense from month_rows
 ), clients as (
  select s.client_id id,coalesce(u.full_name,'Unassigned client') name,sum(s.jobs) jobs,sum(s.revenue) revenue,sum(s.cost) cost,sum(s.revenue-s.cost) profit
  from month_rows s left join st_client_accounts c on c.id=s.client_id left join st_users u on u.id=c.user_id
  where s.client_id is not null group by s.client_id,u.full_name
 ), objects as (
  select s.object_id id,o.code,o.name,sum(s.jobs) jobs,sum(s.revenue) revenue,sum(s.cost) cost,sum(s.revenue-s.cost) profit
  from month_rows s join st_objects o on o.id=s.object_id group by s.object_id,o.code,o.name
 ), trend as (
  select to_char(m,'YYYY-MM') as month,coalesce(sum(s.revenue),0) revenue,coalesce(sum(s.cost),0) expenses,coalesce(sum(s.revenue-s.cost),0) profit
  from generate_series(first_day-interval '11 months',first_day,interval '1 month') m left join source s on s.d>=m and s.d<m+interval '1 month' group by m order by m
 ), entries as materialized (
  select e.*,u.full_name client_name,c.company_name,o.code object_code,o.name object_name
  from st_financial_entries e left join st_client_accounts c on c.id=e.client_id left join st_users u on u.id=c.user_id left join st_objects o on o.id=e.object_id
  where e.entry_date>=first_day and e.entry_date<last_day and (p_before is null or e.id<p_before)
 ) select jsonb_build_object('month',p_month,'from',first_day,'to',last_day-1,
  'summary',jsonb_build_object('totalRevenue',revenue,'totalExpenses',cost,'profit',revenue-cost,'completedJobs',jobs,
   'cleaningRevenue',cleaning,'manualIncome',income,'cleanerPayouts',payout,'cleanerBonuses',bonus,'jobExtraCosts',extras,'manualExpenses',expense,
   'marginPct',case when revenue<>0 then round((revenue-cost)/revenue*100,1) else 0 end,
   'avgRevenuePerJob',case when jobs>0 then revenue/jobs else 0 end,'avgProfitPerJob',case when jobs>0 then (revenue-cost)/jobs else 0 end),
  'byClient',coalesce((select jsonb_agg(to_jsonb(c) order by revenue desc,name) from clients c),'[]'::jsonb),
  'byObject',coalesce((select jsonb_agg(to_jsonb(o) order by revenue desc,name) from objects o),'[]'::jsonb),
  'trend',(select jsonb_agg(to_jsonb(t) order by month) from trend t),
  'entries',coalesce((select jsonb_agg(to_jsonb(e) order by id desc) from (select * from entries order by id desc limit 100) e),'[]'::jsonb),
  'entriesHasMore',(select count(*)>100 from entries),
  'entriesNextCursor',(select min(id) from (select id from entries order by id desc limit 100) p)
 ) into answer from totals;
 return answer;
end $$;
revoke all on function st_finance_report(bigint,text,bigint) from public,anon,authenticated;
grant execute on function st_finance_report(bigint,text,bigint) to service_role;
