-- Run once in a new Supabase project's SQL editor.
-- No private data or keys belong in this file.
begin;

create table if not exists public.inspirations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_url text,
  title text not null check (length(title) between 1 and 160),
  description text not null default '',
  summary text not null default '',
  primary_tag text not null default '人像',
  tags text[] not null default '{}',
  status text not null default 'needs_upload' check (status in ('needs_upload', 'ready')),
  cover_key text,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique(id, user_id),
  unique(user_id, source_url)
);
create table if not exists public.inspiration_images (
  id uuid primary key default gen_random_uuid(),
  inspiration_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_key text not null,
  filename text not null default '',
  content_type text not null,
  position integer not null default 0,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  foreign key (inspiration_id, user_id) references public.inspirations(id, user_id) on delete cascade,
  check (split_part(storage_key, '/', 1) = 'users' and split_part(storage_key, '/', 2) = user_id::text)
);
create table if not exists public.user_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 30),
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique(user_id, name)
);
create table if not exists public.shoot_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  description text not null default '',
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique(id, user_id)
);
create table if not exists public.project_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  inspiration_id uuid not null,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique(project_id, inspiration_id),
  foreign key (project_id, user_id) references public.shoot_projects(id, user_id) on delete cascade,
  foreign key (inspiration_id, user_id) references public.inspirations(id, user_id) on delete cascade
);
create index if not exists inspirations_user_created on public.inspirations(user_id, created_at desc);
create index if not exists images_user_parent on public.inspiration_images(user_id, inspiration_id);
create index if not exists projects_user on public.shoot_projects(user_id);
create index if not exists project_items_user on public.project_items(user_id);
create index if not exists images_parent_owner on public.inspiration_images(inspiration_id, user_id);
create index if not exists project_items_project_owner on public.project_items(project_id, user_id);
create index if not exists project_items_inspiration_owner on public.project_items(inspiration_id, user_id);
grant usage on schema public to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['inspirations', 'inspiration_images', 'user_tags', 'shoot_projects', 'project_items'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    if not exists(select 1 from pg_policies where schemaname = 'public' and tablename = table_name and policyname = 'portrait_owner_only') then
      execute format('create policy portrait_owner_only on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name);
    end if;
  end loop;
end $$;

create or replace function public.change_portrait_tag(old_name text, new_name text default null)
returns void language plpgsql security invoker set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if old_name is null or length(trim(old_name)) = 0 then raise exception 'Missing tag'; end if;
  if new_name is not null and length(trim(new_name)) not between 1 and 30 then raise exception 'Invalid tag'; end if;
  if new_name = old_name then return; end if;
  if new_name is not null then
    insert into public.user_tags(user_id, name) values (auth.uid(), trim(new_name)) on conflict(user_id, name) do nothing;
  end if;
  update public.inspirations
  set tags = array(select distinct case when tag = old_name then trim(new_name) else tag end from unnest(tags) as tag where tag <> old_name or new_name is not null),
      primary_tag = case when primary_tag = old_name then coalesce(trim(new_name), (array_remove(tags, old_name))[1], '人像') else primary_tag end,
      updated_at = (extract(epoch from now()) * 1000)::bigint
  where user_id = auth.uid() and (old_name = any(tags) or primary_tag = old_name);
  delete from public.user_tags where user_id = auth.uid() and name = old_name;
end $$;
revoke all on function public.change_portrait_tag(text,text) from public, anon;
grant execute on function public.change_portrait_tag(text,text) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('portrait-images', 'portrait-images', false, 15000000, array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif','image/avif'])
on conflict(id) do nothing;

do $$
begin
  if not exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'portrait_private_images') then
    create policy portrait_private_images on storage.objects for all to authenticated
    using (bucket_id = 'portrait-images' and (storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = (select auth.uid())::text)
    with check (bucket_id = 'portrait-images' and (storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = (select auth.uid())::text);
  end if;
end $$;
-- The dashboard's automatic-RLS event trigger is internal, not a public RPC.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
commit;
