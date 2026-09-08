-- Run with the database admin connection. Every fixture and write is rolled back.
begin;

create temporary table internal_ops_test_context as
select gen_random_uuid() owner_id, gen_random_uuid() uploader_id, gen_random_uuid() outsider_id,
       gen_random_uuid() org_id, gen_random_uuid() brand_id,
       gen_random_uuid() review_content_id, gen_random_uuid() revision_content_id,
       null::text invite_token;
grant select,update on internal_ops_test_context to authenticated;

insert into auth.users(id,email)
select owner_id,'internal-owner@example.invalid' from internal_ops_test_context union all
select uploader_id,'internal-uploader@example.invalid' from internal_ops_test_context union all
select outsider_id,'internal-outsider@example.invalid' from internal_ops_test_context;

insert into public.organizations(id,name,slug,created_by)
select org_id,'Internal operations rollback test',org_id::text,owner_id from internal_ops_test_context;
insert into public.memberships(organization_id,user_id,role)
select org_id,owner_id,'owner'::public.member_role from internal_ops_test_context;
insert into public.brands(id,organization_id,name,slug,created_by)
select brand_id,org_id,'Internal operations brand',brand_id::text,owner_id from internal_ops_test_context;
insert into public.brand_rules(brand_id,approval_required,posting_windows,min_gap_minutes)
select brand_id,true,
  '[{"day":0,"times":["23:58"]},{"day":1,"times":["23:58"]},{"day":2,"times":["23:58"]},{"day":3,"times":["23:58"]},{"day":4,"times":["23:58"]},{"day":5,"times":["23:58"]},{"day":6,"times":["23:58"]}]'::jsonb,60
from internal_ops_test_context;
insert into public.social_accounts(brand_id,platform,external_account_id,username,access_token_encrypted,status)
select brand_id,'instagram'::public.social_platform,'internal-ig','internal.ig',decode('00','hex'),'connected' from internal_ops_test_context union all
select brand_id,'facebook'::public.social_platform,'internal-fb','Internal FB',decode('00','hex'),'connected' from internal_ops_test_context;

insert into public.content_items(id,brand_id,created_by,title,caption,media_type,primary_asset_path,status,approval_status,ai_metadata)
select review_content_id,brand_id,owner_id,'Needs approval','Caption','image'::public.media_kind,'fixture/approval.jpg','ready'::public.content_status,'pending_review',
  jsonb_build_object('requested_channels',jsonb_build_array('ig_feed','fb_feed'),'requested_schedule_mode','manual','requested_scheduled_for',(now()+interval '2 days'))
from internal_ops_test_context union all
select revision_content_id,brand_id,uploader_id,'Needs revision','Old caption','image'::public.media_kind,'fixture/revision.jpg','ready'::public.content_status,'pending_review',
  jsonb_build_object('requested_channels',jsonb_build_array('ig_feed'),'requested_schedule_mode','manual','requested_scheduled_for',(now()+interval '3 days'))
from internal_ops_test_context;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from internal_ops_test_context),true);

do $$
declare
  ctx internal_ops_test_context;
  invite jsonb;
  rejected boolean := false;
  review_result jsonb;
  first_job uuid;
begin
  select * into ctx from internal_ops_test_context;

  invite := public.create_workspace_invite(ctx.org_id,'internal-uploader@example.invalid','uploader',array[ctx.brand_id]);
  if invite->>'token' is null then raise exception 'invitation token missing'; end if;
  update internal_ops_test_context set invite_token=invite->>'token';

  begin
    perform public.schedule_content_hybrid(ctx.review_content_id,array['ig_feed'],'manual',now()+interval '1 day');
  exception when others then
    if sqlerrm='content requires approval' then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'approval gate was bypassed'; end if;

  review_result := public.review_content(ctx.review_content_id,'approved','Siap tayang');
  if review_result->>'decision' <> 'approved' or (review_result->>'scheduled_count')::integer <> 2 then
    raise exception 'approval did not create requested jobs';
  end if;
  select id into first_job from public.publish_jobs where content_item_id=ctx.review_content_id and platform='instagram';
  perform public.manage_publish_job(first_job,'reschedule',now()+interval '4 days');
  perform public.manage_publish_job(first_job,'cancel',null);
  if (select status from public.publish_jobs where id=first_job) <> 'cancelled' then raise exception 'cancel failed'; end if;

  perform public.review_content(ctx.revision_content_id,'changes_requested','Perbaiki CTA');
  if (select approval_status from public.content_items where id=ctx.revision_content_id) <> 'changes_requested' then
    raise exception 'revision request failed';
  end if;
end $$;

reset role;
update public.publish_jobs set status='failed',error_message='fixture failure'
where content_item_id=(select review_content_id from internal_ops_test_context) and platform='facebook';

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from internal_ops_test_context),true);
do $$
declare failed_job uuid;
begin
  select id into failed_job from public.publish_jobs
  where content_item_id=(select review_content_id from internal_ops_test_context) and platform='facebook';
  perform public.manage_publish_job(failed_job,'retry',now()+interval '10 minutes');
  if (select status from public.publish_jobs where id=failed_job) <> 'scheduled' then raise exception 'retry failed'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select uploader_id::text from internal_ops_test_context),true);
do $$
declare
  ctx internal_ops_test_context;
  accepted jsonb;
  team jsonb;
  activity jsonb;
begin
  select * into ctx from internal_ops_test_context;
  accepted := public.accept_workspace_invite(ctx.invite_token);
  if accepted->>'role' <> 'uploader' then raise exception 'invitation acceptance failed'; end if;
  if not private.can_access_brand(ctx.brand_id) or not private.can_upload_brand(ctx.brand_id) then raise exception 'invited brand access missing'; end if;
  if private.can_edit_brand(ctx.brand_id) or private.can_publish_brand(ctx.brand_id) then raise exception 'uploader received excessive permissions'; end if;
  team := public.list_workspace_team(ctx.org_id);
  if jsonb_array_length(team->'members') <> 1 or team->'members'->0->>'user_id' <> ctx.uploader_id::text then
    raise exception 'non-admin received another member profile';
  end if;
  activity := public.list_workspace_activity(ctx.org_id,100);
  if exists(select 1 from jsonb_array_elements(activity) entry where entry->>'brand_id' is distinct from ctx.brand_id::text) then
    raise exception 'non-admin received workspace-wide activity';
  end if;

  perform public.update_content_details(ctx.revision_content_id,'Revised content','Brief revised','CTA sudah diperbaiki');
  perform public.submit_content_for_review(ctx.revision_content_id);
  if (select approval_status from public.content_items where id=ctx.revision_content_id) <> 'pending_review' then
    raise exception 'creator resubmission failed';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select outsider_id::text from internal_ops_test_context),true);
do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.list_workspace_team((select org_id from internal_ops_test_context));
  exception when others then
    if sqlerrm='forbidden' then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'outsider could list team'; end if;
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon','public.review_content(uuid,text,text)','execute') then raise exception 'anonymous review access allowed'; end if;
  if has_function_privilege('anon','public.manage_publish_job(uuid,text,timestamptz)','execute') then raise exception 'anonymous job management allowed'; end if;
  if has_function_privilege('anon','public.create_workspace_invite(uuid,text,public.member_role,uuid[])','execute') then raise exception 'anonymous invitation access allowed'; end if;
  if has_table_privilege('authenticated','public.workspace_invitations','select') then raise exception 'invitation hashes exposed to authenticated role'; end if;
  if has_table_privilege('authenticated','public.content_items','update') then raise exception 'direct approval-field update remains available'; end if;
end $$;

select
  (select count(*)=2 from public.publish_jobs where content_item_id=(select review_content_id from internal_ops_test_context)) as approval_created_two_jobs,
  (select count(*)>=8 from public.activity_logs where organization_id=(select org_id from internal_ops_test_context)) as activity_history_recorded,
  (select count(*)=1 from public.memberships where organization_id=(select org_id from internal_ops_test_context) and user_id=(select uploader_id from internal_ops_test_context) and role='uploader') as invitation_joined_workspace,
  'approval, revision, reschedule, cancel, retry, invitation, scoped data access and anonymous denial passed' as checks;

rollback;
