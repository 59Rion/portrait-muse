-- Incremental upgrade for the existing cloud. No user content is embedded here.
begin;
create table if not exists public.project_briefs (
  project_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 24000),
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  foreign key (project_id, user_id) references public.shoot_projects(id, user_id) on delete cascade
);
create table if not exists public.shooting_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 90000),
  brief_snapshot jsonb not null check (jsonb_typeof(brief_snapshot) = 'object'),
  origin text not null default 'manual' check (origin in ('manual','ai')),
  note text not null default '' check (length(note) <= 1000),
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique(project_id, version),
  foreign key (project_id, user_id) references public.shoot_projects(id, user_id) on delete cascade
);
create table if not exists public.project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null check (length(content) <= 12000),
  detail jsonb not null default '{}' check (octet_length(detail::text) <= 100000),
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  foreign key (project_id, user_id) references public.shoot_projects(id, user_id) on delete cascade
);
create index if not exists project_briefs_owner on public.project_briefs(user_id, project_id);
create index if not exists shooting_plans_owner on public.shooting_plans(user_id, project_id, created_at desc);
create index if not exists shooting_plans_parent on public.shooting_plans(project_id, user_id);
create index if not exists project_messages_owner on public.project_messages(user_id, project_id, created_at desc);
create index if not exists project_messages_parent on public.project_messages(project_id, user_id);
create index if not exists project_messages_rate_window on public.project_messages(user_id, created_at desc) where role='user';
do $$ declare t text; begin
  foreach t in array array['project_briefs','shooting_plans','project_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert on public.%I to authenticated', t);
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='portrait_owner_only') then
      execute format('create policy portrait_owner_only on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)', t);
    end if;
  end loop;
end $$;
grant update on public.project_briefs to authenticated;

-- All references are validated even if someone bypasses the UI and calls REST.
create or replace function public.check_shooting_plan_references()
returns trigger language plpgsql security invoker set search_path=public as $$
declare ref text;
begin
  if jsonb_typeof(new.plan->'referenceIds') is distinct from 'array' then raise exception 'Invalid references'; end if;
  if jsonb_array_length(new.plan->'referenceIds') > 30 then raise exception 'Too many references'; end if;
  for ref in select jsonb_array_elements_text(new.plan->'referenceIds') loop
    if not exists(select 1 from public.inspirations where id::text=ref and user_id=new.user_id) then raise exception 'Reference unavailable'; end if;
  end loop;
  return new;
end $$;
revoke all on function public.check_shooting_plan_references() from public, anon, authenticated;
drop trigger if exists validate_shooting_plan_references on public.shooting_plans;
create trigger validate_shooting_plan_references before insert on public.shooting_plans for each row execute function public.check_shooting_plan_references();

-- One explicit user confirmation creates an immutable version and associates its references atomically.
create or replace function public.confirm_shooting_plan(p_project uuid, p_plan jsonb, p_brief jsonb, p_origin text default 'manual', p_note text default '')
returns public.shooting_plans language plpgsql security invoker set search_path=public as $$
declare result public.shooting_plans; n integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform 1 from public.shoot_projects where id=p_project and user_id=auth.uid() for update;
  if not found then raise exception 'Project unavailable'; end if;
  perform 1 from public.project_briefs where project_id=p_project and user_id=auth.uid() for update;
  if (select data from public.project_briefs where project_id=p_project and user_id=auth.uid()) is distinct from p_brief then raise exception 'Requirements changed; save and reload first'; end if;
  select coalesce(max(version),0)+1 into n from public.shooting_plans where project_id=p_project and user_id=auth.uid();
  insert into public.shooting_plans(project_id,user_id,version,plan,brief_snapshot,origin,note)
    values(p_project,auth.uid(),n,p_plan,p_brief,p_origin,p_note) returning * into result;
  insert into public.project_items(project_id,user_id,inspiration_id)
    select p_project, auth.uid(), ref::uuid from jsonb_array_elements_text(p_plan->'referenceIds') ref
    on conflict(project_id,inspiration_id) do nothing;
  return result;
end $$;
revoke all on function public.confirm_shooting_plan(uuid,jsonb,jsonb,text,text) from public, anon;
grant execute on function public.confirm_shooting_plan(uuid,jsonb,jsonb,text,text) to authenticated;

create or replace function public.claim_shooting_agent_turn(p_project uuid, p_content text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare result uuid; ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(p_content)) not between 1 and 6000 then raise exception 'Invalid message'; end if;
  if not exists(select 1 from public.shoot_projects where id=p_project and user_id=auth.uid()) then raise exception 'Project unavailable'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if (select count(*) from public.project_messages where user_id=auth.uid() and role='user' and created_at>ms-60000) >= 3
     or (select count(*) from public.project_messages where user_id=auth.uid() and role='user' and created_at>ms-86400000) >= 100 then
    raise exception '请求过于频繁，请稍后重试（每分钟3次、每天100次）。';
  end if;
  insert into public.project_messages(project_id,user_id,role,content) values(p_project,auth.uid(),'user',p_content) returning id into result;
  return result;
end $$;
revoke all on function public.claim_shooting_agent_turn(uuid,text) from public, anon;
grant execute on function public.claim_shooting_agent_turn(uuid,text) to authenticated;
commit;
