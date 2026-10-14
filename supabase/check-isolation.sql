-- Verifies real database policies using temporary fixtures. Everything rolls back.
begin;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); ia uuid := gen_random_uuid(); ib uuid := gen_random_uuid();
begin
  perform set_config('portrait.test_a', a::text, true);
  perform set_config('portrait.test_b', b::text, true);
  perform set_config('portrait.item_a', ia::text, true);
  perform set_config('portrait.item_b', ib::text, true);
  insert into auth.users(id, email, aud, role) values
    (a, 'portrait-test-a-' || a || '@example.invalid', 'authenticated', 'authenticated'),
    (b, 'portrait-test-b-' || b || '@example.invalid', 'authenticated', 'authenticated');
  insert into public.inspirations(id,user_id,title,tags,primary_tag) values
    (ia,a,'ISOLATION TEST A',array['测试标签'],'测试标签'),
    (ib,b,'ISOLATION TEST B',array['测试标签'],'测试标签');
  insert into public.user_tags(user_id,name) values (a,'测试标签'),(b,'测试标签');
  insert into storage.objects(bucket_id,name) values
    ('portrait-images','users/' || a || '/inspirations/' || ia || '/test.png'),
    ('portrait-images','users/' || b || '/inspirations/' || ib || '/test.png');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('portrait.test_a'), true);
select set_config('request.jwt.claims', json_build_object('sub',current_setting('portrait.test_a'),'role','authenticated')::text,true);
do $$
begin
  if (select count(*) from public.inspirations) <> 1 then raise exception 'Cross-account read isolation failed'; end if;
  if (select count(*) from storage.objects where bucket_id='portrait-images') <> 1 then raise exception 'Private image isolation failed'; end if;
  update public.inspirations set title='FORBIDDEN' where id=current_setting('portrait.item_b')::uuid;
  if found then raise exception 'Cross-account update was allowed'; end if;
  begin
    insert into public.user_tags(user_id,name) values(current_setting('portrait.test_b')::uuid,'FORBIDDEN');
    raise exception 'Cross-account insert was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.inspirations set user_id=current_setting('portrait.test_b')::uuid where id=current_setting('portrait.item_a')::uuid;
    raise exception 'Owner reassignment was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.inspiration_images(user_id,inspiration_id,storage_key,content_type)
    values(current_setting('portrait.test_a')::uuid,current_setting('portrait.item_b')::uuid,'users/' || current_setting('portrait.test_a') || '/test.png','image/png');
    raise exception 'Cross-account parent relation was allowed';
  exception when foreign_key_violation then null;
  end;
  perform public.change_portrait_tag('测试标签','已改名');
  if not exists(select 1 from public.inspirations where tags=array['已改名']) then raise exception 'Owner tag rename failed'; end if;
  perform public.change_portrait_tag('已改名',null);
  if exists(select 1 from public.inspirations where cardinality(tags)<>0) then raise exception 'Owner tag removal failed'; end if;
end $$;
reset role;
do $$
begin
  if not exists(select 1 from public.inspirations where id=current_setting('portrait.item_b')::uuid and tags=array['测试标签'] and title='ISOLATION TEST B') then raise exception 'Another account was modified'; end if;
end $$;
rollback;
select 'PASS: owner reads/writes, owner reassignment denial, cross-account parent denial, tag rename/delete and private image metadata isolation. All fixtures rolled back.' as verification;
