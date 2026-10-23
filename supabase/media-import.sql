-- Additive upgrade: existing images and owner policies are preserved.
begin;
alter table public.inspiration_images add column if not exists media_bucket text not null default 'portrait-images'
  check (media_bucket in ('portrait-images', 'portrait-videos'));
alter table public.inspirations add column if not exists import_started_at bigint not null default 0;
alter table public.inspirations add column if not exists imported_at bigint not null default 0;
create index if not exists inspirations_import_user_time on public.inspirations(user_id, import_started_at desc);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('portrait-videos','portrait-videos',false,40000000,array['video/mp4']) on conflict(id) do nothing;
create policy portrait_private_videos on storage.objects for all to authenticated
using (bucket_id = 'portrait-videos' and (storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = (select auth.uid())::text)
with check (bucket_id = 'portrait-videos' and (storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = (select auth.uid())::text);
create or replace function public.claim_portrait_import(p_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 912));
  if not exists(select 1 from public.inspirations where id=p_id and user_id=auth.uid()) then raise exception '收藏不存在或无权访问'; end if;
  if exists(select 1 from public.inspirations where id=p_id and import_started_at > now_ms-150000) then raise exception '这篇收藏正在导入或刚刚尝试过，请稍后重试'; end if;
  if (select count(*) from public.inspirations where user_id=auth.uid() and import_started_at > now_ms-60000) >= 3 then raise exception '请求过于频繁，请一分钟后重试'; end if;
  update public.inspirations set import_started_at=now_ms where id=p_id and user_id=auth.uid();
end $$;
revoke all on function public.claim_portrait_import(uuid) from public, anon;
grant execute on function public.claim_portrait_import(uuid) to authenticated;
commit;

