-- Run with the database admin connection. Every fixture and write is rolled back.
begin;

create temporary table hybrid_schedule_test_context as
select gen_random_uuid() owner_id, gen_random_uuid() other_id,
       gen_random_uuid() org_id, gen_random_uuid() other_org_id,
       gen_random_uuid() brand_id, gen_random_uuid() other_brand_id,
       gen_random_uuid() manual_content_id, gen_random_uuid() auto_content_id,
       gen_random_uuid() smart_content_id;
grant select on hybrid_schedule_test_context to authenticated;

insert into auth.users(id)
select owner_id from hybrid_schedule_test_context union all
select other_id from hybrid_schedule_test_context;

insert into public.organizations(id,name,slug,created_by)
select org_id,'Hybrid schedule rollback test',org_id::text,owner_id from hybrid_schedule_test_context union all
select other_org_id,'Other hybrid rollback test',other_org_id::text,other_id from hybrid_schedule_test_context;

insert into public.memberships(organization_id,user_id,role)
select org_id,owner_id,'owner'::public.member_role from hybrid_schedule_test_context union all
select other_org_id,other_id,'owner'::public.member_role from hybrid_schedule_test_context;

insert into public.brands(id,organization_id,name,slug,created_by)
select brand_id,org_id,'Hybrid test brand',brand_id::text,owner_id from hybrid_schedule_test_context union all
select other_brand_id,other_org_id,'Other hybrid brand',other_brand_id::text,other_id from hybrid_schedule_test_context;

insert into public.brand_rules(brand_id,posting_windows,min_gap_minutes)
select brand_id,
  '[{"day":0,"times":["23:59"]},{"day":1,"times":["23:59"]},{"day":2,"times":["23:59"]},{"day":3,"times":["23:59"]},{"day":4,"times":["23:59"]},{"day":5,"times":["23:59"]},{"day":6,"times":["23:59"]}]'::jsonb,
  60
from hybrid_schedule_test_context union all
select other_brand_id,
  '[{"day":0,"times":["23:59"]}]'::jsonb,
  60
from hybrid_schedule_test_context;

insert into public.social_accounts(brand_id,platform,external_account_id,username,access_token_encrypted,status)
select brand_id,'instagram'::public.social_platform,'hybrid-ig','hybrid.ig',decode('00','hex'),'connected' from hybrid_schedule_test_context union all
select brand_id,'facebook'::public.social_platform,'hybrid-fb','Hybrid FB',decode('00','hex'),'connected' from hybrid_schedule_test_context;

insert into public.content_items(id,brand_id,created_by,title,media_type,primary_asset_path,status)
select manual_content_id,brand_id,owner_id,'Manual hybrid test','image'::public.media_kind,'fixture/manual.jpg','ready'::public.content_status from hybrid_schedule_test_context union all
select auto_content_id,brand_id,owner_id,'Auto hybrid test','image'::public.media_kind,'fixture/auto.jpg','ready'::public.content_status from hybrid_schedule_test_context union all
select smart_content_id,brand_id,owner_id,'Smart hybrid test','video'::public.media_kind,'fixture/smart.mp4','ready'::public.content_status from hybrid_schedule_test_context;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from hybrid_schedule_test_context),true);

do $$
declare
  target uuid;
  other_target uuid;
  manual_id uuid;
  auto_id uuid;
  smart_id uuid;
  recommended jsonb;
  rejected boolean;
begin
  select brand_id,other_brand_id,manual_content_id,auto_content_id,smart_content_id
  into target,other_target,manual_id,auto_id,smart_id
  from hybrid_schedule_test_context;

  perform public.update_brand_schedule_rules(
    target,true,120,
    '[{"day":0,"times":["09:00","18:30"]},{"day":1,"times":["09:00","18:30"]},{"day":2,"times":["09:00","18:30"]},{"day":3,"times":["09:00","18:30"]},{"day":4,"times":["09:00","18:30"]},{"day":5,"times":["09:00","18:30"]},{"day":6,"times":["09:00","18:30"]}]'::jsonb
  );
  if (select min_gap_minutes from public.brand_rules where brand_id=target) <> 120 then
    raise exception 'brand rule update failed';
  end if;

  recommended := public.recommend_content_schedule(target,'smart');
  if recommended->>'mode' <> 'smart' or recommended->>'scheduled_for' is null then
    raise exception 'smart recommendation failed';
  end if;

  perform public.schedule_content_hybrid(manual_id,array['ig_feed','fb_feed'],'manual',now()+interval '2 days');
  if (select count(*) from public.publish_jobs where content_item_id=manual_id) <> 2 then
    raise exception 'manual multi-channel schedule failed';
  end if;
  if exists(select 1 from public.publish_jobs where content_item_id=manual_id and metadata->>'schedule_mode' <> 'manual') then
    raise exception 'manual metadata missing';
  end if;

  perform public.schedule_content_hybrid(auto_id,array['ig_feed'],'auto',null);
  if not exists(select 1 from public.publish_jobs where content_item_id=auto_id and metadata->>'schedule_mode'='auto') then
    raise exception 'auto schedule failed';
  end if;

  perform public.schedule_content_hybrid(smart_id,array['ig_reel'],'smart',null);
  if not exists(select 1 from public.publish_jobs where content_item_id=smart_id and metadata->>'schedule_mode'='smart') then
    raise exception 'smart schedule failed';
  end if;

  rejected := false;
  begin
    perform public.update_brand_schedule_rules(target,true,1500,'[{"day":1,"times":["09:00"]}]'::jsonb);
  exception when others then
    if sqlerrm='minimum gap must be between 0 and 1440 minutes' then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'invalid gap was accepted'; end if;

  rejected := false;
  begin
    perform public.recommend_content_schedule(other_target,'smart');
  exception when others then
    if sqlerrm='forbidden' then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'cross-organization recommendation allowed'; end if;
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon','public.recommend_content_schedule(uuid,text)','execute') then raise exception 'anonymous recommendation access allowed'; end if;
  if has_function_privilege('anon','public.schedule_content_hybrid(uuid,text[],text,timestamptz)','execute') then raise exception 'anonymous hybrid scheduling access allowed'; end if;
  if not has_function_privilege('authenticated','public.schedule_content_hybrid(uuid,text[],text,timestamptz)','execute') then raise exception 'authenticated hybrid scheduling grant missing'; end if;
end $$;

select
  (select count(*)=4 from public.publish_jobs where content_item_id in(select manual_content_id from hybrid_schedule_test_context union all select auto_content_id from hybrid_schedule_test_context union all select smart_content_id from hybrid_schedule_test_context)) as four_jobs_created,
  (select bool_and(scheduled_for>now()) from public.publish_jobs where content_item_id in(select manual_content_id from hybrid_schedule_test_context union all select auto_content_id from hybrid_schedule_test_context union all select smart_content_id from hybrid_schedule_test_context)) as every_job_is_future,
  'manual, auto, smart, validation, cross-org denial and grants passed' as checks;

rollback;
