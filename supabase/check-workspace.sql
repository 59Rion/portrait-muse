-- Run after project-workspace.sql. Real policy tests; all fixtures roll back.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid(); ia uuid:=gen_random_uuid(); ib uuid:=gen_random_uuid();
begin
  perform set_config('portrait.a',a::text,true); perform set_config('portrait.b',b::text,true);
  perform set_config('portrait.pa',pa::text,true); perform set_config('portrait.pb',pb::text,true);
  perform set_config('portrait.ia',ia::text,true); perform set_config('portrait.ib',ib::text,true);
  insert into auth.users(id,email,aud,role) values(a,'workspace-a-'||a||'@example.invalid','authenticated','authenticated'),(b,'workspace-b-'||b||'@example.invalid','authenticated','authenticated');
  insert into public.shoot_projects(id,user_id,name) values(pa,a,'TEST A'),(pb,b,'TEST B');
  insert into public.inspirations(id,user_id,title) values(ia,a,'TEST A'),(ib,b,'TEST B');
  insert into public.project_briefs(project_id,user_id,data) values(pa,a,'{"purpose":"TEST A"}'),(pb,b,'{"purpose":"TEST B"}');
  insert into public.project_messages(project_id,user_id,role,content) values(pb,b,'user','TEST B');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('portrait.a'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('portrait.a'),'role','authenticated')::text,true);
do $$
declare p uuid:=current_setting('portrait.pa')::uuid; u uuid:=current_setting('portrait.a')::uuid; plan jsonb; v public.shooting_plans;
begin
  if (select count(*) from public.project_briefs where project_id in(p,current_setting('portrait.pb')::uuid))<>1 then raise exception 'Cross-owner brief read'; end if;
  if exists(select 1 from public.project_messages where project_id=current_setting('portrait.pb')::uuid) then raise exception 'Cross-owner message read'; end if;
  begin
    insert into public.project_messages(project_id,user_id,role,content) values(current_setting('portrait.pb')::uuid,u,'user','FORBIDDEN');
    raise exception 'Cross-owner project relation accepted';
  exception when foreign_key_violation then null;
  end;
  plan:=jsonb_build_object('goal','TEST PLAN','referenceIds',jsonb_build_array(current_setting('portrait.ia')));
  select * into v from public.confirm_shooting_plan(p,plan,'{"purpose":"TEST A"}','manual','v1');
  if v.version<>1 then raise exception 'Version one failed'; end if;
  select * into v from public.confirm_shooting_plan(p,plan,'{"purpose":"TEST A"}','manual','v2');
  if v.version<>2 or (select count(*) from public.shooting_plans where project_id=p)<>2 then raise exception 'Version append failed'; end if;
  if (select count(*) from public.project_items where project_id=p)<>1 then raise exception 'Reference association was not idempotent'; end if;
  begin
    update public.shooting_plans set note='CHANGED' where project_id=p;
    raise exception 'Version was mutable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.confirm_shooting_plan(p,plan,'{"purpose":"STALE"}','manual','bad snapshot');
    raise exception 'Stale brief accepted';
  exception when raise_exception then if sqlerrm not like 'Requirements changed%' then raise; end if;
  end;
  begin
    perform public.confirm_shooting_plan(p,jsonb_set(plan,'{referenceIds}',jsonb_build_array(current_setting('portrait.ib'))),'{"purpose":"TEST A"}','manual','foreign ref');
    raise exception 'Foreign reference accepted';
  exception when raise_exception then if sqlerrm<>'Reference unavailable' then raise; end if;
  end;
  if (select count(*) from public.shooting_plans where project_id=p)<>2 then raise exception 'Failed save left partial version'; end if;
  perform public.claim_shooting_agent_turn(p,'test1'); perform public.claim_shooting_agent_turn(p,'test2'); perform public.claim_shooting_agent_turn(p,'test3');
  begin
    perform public.claim_shooting_agent_turn(p,'test4');
    raise exception 'Rate limit failed';
  exception when raise_exception then if sqlerrm not like '请求过于频繁%' then raise; end if;
  end;
end $$;
reset role;
rollback;
select 'PASS: owner scope, immutable versions, atomic references, stale brief rejection, foreign reference rejection and rate limit. All fixtures rolled back.' as verification;
