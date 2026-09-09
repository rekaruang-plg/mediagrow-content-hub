-- Run with the database admin connection after the migration. Every fixture is rolled back.
begin;
create temporary table channel_test_context as
select gen_random_uuid() owner_id, gen_random_uuid() outsider_id, gen_random_uuid() org_id,
       gen_random_uuid() brand_id, gen_random_uuid() instagram_id, gen_random_uuid() facebook_id,
       null::uuid content_id, null::uuid duplicate_id;
grant select,update on channel_test_context to authenticated;

insert into auth.users(id,email)
select owner_id,'channel-owner@example.invalid' from channel_test_context union all
select outsider_id,'channel-outsider@example.invalid' from channel_test_context;
insert into public.organizations(id,name,slug,created_by)
select org_id,'Channel rollback test',org_id::text,owner_id from channel_test_context;
insert into public.memberships(organization_id,user_id,role)
select org_id,owner_id,'owner'::public.member_role from channel_test_context union all
select org_id,outsider_id,'viewer'::public.member_role from channel_test_context;
insert into public.brands(id,organization_id,name,slug,created_by)
select brand_id,org_id,'Channel Test',brand_id::text,owner_id from channel_test_context;
insert into public.brand_rules(brand_id,approval_required,posting_windows)
select brand_id,false,'[{"day":0,"times":["18:30"]},{"day":1,"times":["18:30"]},{"day":2,"times":["18:30"]},{"day":3,"times":["18:30"]},{"day":4,"times":["18:30"]},{"day":5,"times":["18:30"]},{"day":6,"times":["18:30"]}]'::jsonb from channel_test_context;
insert into public.social_accounts(id,brand_id,platform,external_account_id,access_token_encrypted,status)
select instagram_id,brand_id,'instagram'::public.social_platform,'ig-channel-test','fixture'::bytea,'connected' from channel_test_context union all
select facebook_id,brand_id,'facebook'::public.social_platform,'fb-channel-test','fixture'::bytea,'connected' from channel_test_context;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from channel_test_context),true);
do $$
declare ctx channel_test_context; created jsonb; duplicate_result jsonb;
begin
  select * into ctx from channel_test_context;
  created := public.create_content_with_channel_settings(
    ctx.brand_id,'Promo dua channel','Fakta promo','Caption utama','feed',
    jsonb_build_array(jsonb_build_object('storage_path',ctx.brand_id::text||'/fixture/feed.jpg','media_type','image','mime_type','image/jpeg','width',1080,'height',1350,'bytes',500000)),
    array['ig_feed','fb_feed'],'manual',now()+interval '2 days',
    jsonb_build_array(
      jsonb_build_object('channel','ig_feed','caption','Caption khusus Instagram','scheduled_for',now()+interval '2 days'),
      jsonb_build_object('channel','fb_feed','caption','Caption khusus Facebook','scheduled_for',now()+interval '3 days')
    )
  );
  update channel_test_context set content_id=(created->>'content_id')::uuid;
  if (select count(*) from public.publish_jobs where content_item_id=(created->>'content_id')::uuid and caption like 'Caption khusus%')<>2 then raise exception 'channel captions missing'; end if;
  if (select count(distinct scheduled_for) from public.publish_jobs where content_item_id=(created->>'content_id')::uuid)<>2 then raise exception 'channel schedules are not distinct'; end if;
  duplicate_result := public.duplicate_content_item((created->>'content_id')::uuid);
  update channel_test_context set duplicate_id=(duplicate_result->>'content_id')::uuid;
end $$;

do $$
begin
  if (select approval_status from public.content_items where id=(select duplicate_id from channel_test_context))<>'draft' then raise exception 'duplicate is not a draft'; end if;
  if (select count(*) from public.content_assets where content_item_id=(select duplicate_id from channel_test_context))<>1 then raise exception 'duplicate assets missing'; end if;
  if exists(select 1 from public.publish_jobs where content_item_id=(select duplicate_id from channel_test_context)) then raise exception 'duplicate created publish jobs'; end if;
  if exists(select 1 from jsonb_array_elements((select ai_metadata->'requested_channel_settings' from public.content_items where id=(select duplicate_id from channel_test_context))) setting where nullif(setting->>'scheduled_for','') is not null) then raise exception 'duplicate retained old channel schedule'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select outsider_id::text from channel_test_context),true);
do $$ declare rejected boolean:=false;
begin
  begin perform public.duplicate_content_item((select content_id from channel_test_context));
  exception when others then if sqlerrm='forbidden' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'outsider duplicated inaccessible content'; end if;
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon','public.create_content_with_channel_settings(uuid,text,text,text,text,jsonb,text[],text,timestamptz,jsonb)','execute')
     or has_function_privilege('anon','public.update_content_customization(uuid,text,text,text,jsonb)','execute')
     or has_function_privilege('anon','public.duplicate_content_item(uuid)','execute') then
    raise exception 'anonymous channel customization access allowed';
  end if;
end $$;

select
  (select count(*)=2 from public.publish_jobs where content_item_id=(select content_id from channel_test_context)) channel_jobs_created,
  (select count(*)=1 from public.content_items where id=(select duplicate_id from channel_test_context)) duplicate_created,
  'per-channel caption/time, safe duplication, and anonymous denial passed' checks;
rollback;
