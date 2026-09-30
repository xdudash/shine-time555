-- Recovered verbatim from production (supabase_migrations.schema_migrations, version 20260909220128)
-- on 2026-10-01. Already applied in production; kept here so fresh environments match.
create table public.st_object_photos (
 id bigint generated always as identity primary key,
 object_id bigint not null references public.st_objects(id) on delete cascade,
 storage_path text not null unique,
 caption text not null default '' check (length(caption)<=300),
 mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
 created_by bigint not null references public.st_users(id),
 created_at timestamptz not null default now()
);
create index st_object_photos_object_idx on public.st_object_photos(object_id,id);
alter table public.st_object_photos enable row level security;
revoke all on public.st_object_photos from public,anon,authenticated;
grant all on public.st_object_photos to service_role;
grant usage,select on sequence public.st_object_photos_id_seq to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('st-property-guides','st-property-guides',false,5242880,array['image/jpeg','image/png','image/webp']);
-- Guard against unrelated permissive Storage policies, including future ones.
create policy st_property_guides_backend_only on storage.objects as restrictive
for all to anon,authenticated
using (bucket_id <> 'st-property-guides')
with check (bucket_id <> 'st-property-guides');
