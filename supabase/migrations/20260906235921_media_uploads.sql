-- Lock in the same order as job commands, then reauthorize each evidence write.
create or replace function public.st_update_job_checklist(p_actor_id bigint,p_job_id bigint,p_item_id bigint,p_completed boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.st_jobs%rowtype;
begin
 select * into strict v_job from public.st_jobs where id=p_job_id;
 perform pg_advisory_xact_lock(hashtext(v_job.service_date::text));
 select * into strict v_job from public.st_jobs where id=p_job_id for update;
 if not exists(select 1 from st_users u join st_cleaners c on c.user_id=u.id where u.id=p_actor_id and u.active and u.role='CLEANER' and c.active and c.id=v_job.assigned_cleaner_id) then raise exception 'Job is not assigned to you'; end if;
 if v_job.status in ('COMPLETED','CANCELLED') then raise exception 'Terminal job cannot be changed'; end if;
 if p_completed is null then raise exception 'Completed must be boolean'; end if;
 update st_job_checklist set completed=p_completed,completed_at=case when p_completed then now() end,completed_by_user_id=case when p_completed then p_actor_id end where id=p_item_id and job_id=p_job_id;
 if not found then raise exception 'Checklist item not found'; end if;
 insert into st_job_signals(job_id,changed_at) values(p_job_id,clock_timestamp()) on conflict(job_id) do update set changed_at=excluded.changed_at;
end $$;
create or replace function public.st_record_job_photo(p_actor_id bigint,p_job_id bigint,p_category text,p_path text,p_name text,p_mime text,p_size bigint)
returns public.st_job_photos language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.st_jobs%rowtype; v_photo public.st_job_photos%rowtype;
begin
 select * into strict v_job from st_jobs where id=p_job_id;
 perform pg_advisory_xact_lock(hashtext(v_job.service_date::text));
 select * into strict v_job from st_jobs where id=p_job_id for update;
 if not exists(select 1 from st_users u join st_cleaners c on c.user_id=u.id where u.id=p_actor_id and u.active and u.role='CLEANER' and c.active and c.id=v_job.assigned_cleaner_id) then raise exception 'Job is not assigned to you'; end if;
 if v_job.status in ('COMPLETED','CANCELLED') then raise exception 'Terminal job cannot be changed'; end if;
 if p_mime not in ('image/jpeg','image/png','image/webp','video/mp4','video/webm') or p_size is null or p_size<1 or p_size>(case when p_mime like 'video/%' then 52428800 else 5242880 end) then raise exception 'Invalid photo'; end if;
 if p_path is null or p_path not like p_job_id::text||'/%' or length(p_category)>100 or nullif(btrim(p_category),'') is null then raise exception 'Invalid photo metadata'; end if;
 insert into st_job_photos(job_id,cleaner_id,category,storage_path,file_name,mime,file_size) values(p_job_id,v_job.assigned_cleaner_id,p_category,p_path,left(p_name,255),p_mime,p_size) returning * into v_photo;
 insert into st_job_events(job_id,user_id,event_type,payload_json) values(p_job_id,p_actor_id,'PHOTO_UPLOADED',jsonb_build_object('photoId',v_photo.id,'category',p_category));
 insert into st_job_signals(job_id,changed_at) values(p_job_id,clock_timestamp()) on conflict(job_id) do update set changed_at=excluded.changed_at;
 return v_photo;
end $$;
revoke all on function public.st_update_job_checklist(bigint,bigint,bigint,boolean) from public,anon,authenticated;
revoke all on function public.st_record_job_photo(bigint,bigint,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.st_update_job_checklist(bigint,bigint,bigint,boolean) to service_role;
grant execute on function public.st_record_job_photo(bigint,bigint,text,text,text,text,bigint) to service_role;
