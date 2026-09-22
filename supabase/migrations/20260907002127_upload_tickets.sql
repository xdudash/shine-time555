create table st_upload_tickets(
 id uuid primary key,
 actor_id bigint not null references st_users(id),
 job_id bigint not null references st_jobs(id),
 category text not null check(length(category) between 1 and 100),
 storage_path text not null unique,
 file_name text not null,
 mime text not null check(mime in ('image/jpeg','image/png','image/webp','video/mp4','video/webm')),
 file_size bigint not null check(file_size between 1 and case when mime like 'video/%' then 52428800 else 5242880 end),
 expires_at timestamptz not null default now()+interval '2 hours',
 photo_id bigint references st_job_photos(id),
 created_at timestamptz not null default now()
);
alter table st_upload_tickets enable row level security;
revoke all on st_upload_tickets from public,anon,authenticated;
grant all on st_upload_tickets to service_role;
create index st_upload_tickets_expiry_idx on st_upload_tickets(expires_at) where photo_id is null;
create function st_finalize_upload(p_actor_id bigint,p_ticket uuid) returns st_job_photos
language plpgsql security definer set search_path=public,pg_temp as $$
declare ticket st_upload_tickets%rowtype;photo st_job_photos%rowtype;j st_jobs%rowtype;
begin
 select * into strict ticket from st_upload_tickets where id=p_ticket and actor_id=p_actor_id;
 select * into strict j from st_jobs where id=ticket.job_id;
 perform pg_advisory_xact_lock(hashtext(j.service_date::text));
 select * into strict j from st_jobs where id=ticket.job_id for update;
 select * into strict ticket from st_upload_tickets where id=p_ticket and actor_id=p_actor_id for update;
 if not exists(select 1 from st_users u join st_cleaners c on c.user_id=u.id where u.id=p_actor_id and u.active and u.role='CLEANER' and c.active and c.id=j.assigned_cleaner_id) then raise exception 'Job is not assigned to you';end if;
 if ticket.photo_id is not null then select * into strict photo from st_job_photos where id=ticket.photo_id;return photo;end if;
 if ticket.expires_at<now() then raise exception 'Upload expired';end if;
 photo:=st_record_job_photo(p_actor_id,ticket.job_id,ticket.category,ticket.storage_path,ticket.file_name,ticket.mime,ticket.file_size);
 update st_upload_tickets set photo_id=photo.id where id=ticket.id;
 return photo;
end $$;
revoke all on function st_finalize_upload(bigint,uuid) from public,anon,authenticated;
grant execute on function st_finalize_upload(bigint,uuid) to service_role;

update storage.buckets set file_size_limit=52428800,allowed_mime_types=array['image/jpeg','image/png','image/webp','video/mp4','video/webm'] where id='st-cleaning-media';
