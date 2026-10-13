\set ON_ERROR_STOP 1
\ir seed.sql
\echo == 1. only an administrator may write a finance entry
do $$begin perform st_save_finance_entry(6,jsonb_build_object('entryType','EXPENSE','amount',10)); exception when others then raise notice 'ops manager refused: %',sqlerrm; end$$;
do $$begin perform st_save_finance_entry(4,jsonb_build_object('entryType','EXPENSE','amount',10)); exception when others then raise notice 'owner refused: %',sqlerrm; end$$;
\echo == 2. a bad type or a non-positive amount is refused
do $$begin perform st_save_finance_entry(1,jsonb_build_object('entryType','GIFT','amount',10)); exception when others then raise notice 'refused: %',sqlerrm; end$$;
do $$begin perform st_save_finance_entry(1,jsonb_build_object('entryType','EXPENSE','amount',0)); exception when others then raise notice 'refused: %',sqlerrm; end$$;
\echo == 3. creating an entry records a CREATE in the audit
select id,entry_type,category,amount,description from st_save_finance_entry(1,jsonb_build_object('entryType','EXPENSE','category','LAUNDRY','amount',24.5,'description','Towels','entryDate','2026-10-05'));
select action,before_json is null as no_before,(after_json->>'amount')::numeric as after_amount,reason from st_finance_entry_audit order by id;
\echo == 4. correcting it keeps both sides and the reason
select id,amount,description from st_save_finance_entry(1,jsonb_build_object('id',1,'entryType','EXPENSE','category','LAUNDRY','amount',19.9,'description','Towels (corrected)','entryDate','2026-10-05','reason','Wrong amount on the invoice'));
select action,(before_json->>'amount')::numeric as before_amount,(after_json->>'amount')::numeric as after_amount,reason from st_finance_entry_audit order by id;
select count(*) as entries_still_one from st_financial_entries;
\echo == 5. the history is readable for the administrator and closed to everyone else
select jsonb_array_length(st_finance_entry_history(1,1)->'history') as history_rows;
do $$begin perform st_finance_entry_history(6,1); exception when others then raise notice 'ops manager refused: %',sqlerrm; end$$;
\echo == 6. deleting keeps the whole row in the audit, so it can still be read back
select jsonb_pretty(st_delete_finance_entry(1,1,'Duplicate of the supplier invoice'));
select count(*) as entries_left from st_financial_entries;
select action,(before_json->>'description') as kept_description,(before_json->>'amount')::numeric as kept_amount,reason from st_finance_entry_audit where action='DELETE';
select jsonb_array_length(st_finance_entry_history(1,1)->'history') as history_after_delete;
\echo == 7. deleting something that is not there says so
do $$begin perform st_delete_finance_entry(1,999,'x'); exception when others then raise notice 'refused: %',sqlerrm; end$$;
\echo == 8. recorded settlements are not editable through any of this
select count(*) as settlement_edit_functions from pg_proc
 where proname like 'st_%settlement%' and prosrc like '%update public.st_settlements%';
\echo == 9. a photo caption is corrected in place, by the people who may edit the property
insert into st_object_photos(object_id,storage_path,caption,mime,created_by) values(1,'1/abc.jpg','Entrance','image/jpeg',1);
select id,caption from st_update_photo_caption(1,1,1,'Entrance from the courtyard');
select id,caption from st_update_photo_caption(4,1,1,'Owner can rename it too');
do $$begin perform st_update_photo_caption(5,1,1,'manager cannot'); exception when others then raise notice 'property manager refused: %',sqlerrm; end$$;
do $$begin perform st_update_photo_caption(2,1,1,'cleaner cannot'); exception when others then raise notice 'cleaner refused: %',sqlerrm; end$$;
do $$begin perform st_update_photo_caption(1,2,1,'wrong property'); exception when others then raise notice 'refused: %',sqlerrm; end$$;
select caption,length(caption) as kept from st_object_photos where id=1;
\echo == 10. the audit table is closed to signed-in clients
select has_table_privilege('authenticated','st_finance_entry_audit','select') as authenticated_can_read_audit,
       has_function_privilege('authenticated','st_save_finance_entry(bigint,jsonb)','execute') as authenticated_can_write_entries;
