-- Run with the database admin connection. Every fixture and write is rolled back.
begin;
create temporary table planner_test_context as
select gen_random_uuid() owner_id,gen_random_uuid() worker_id,gen_random_uuid() outsider_id,
       gen_random_uuid() org_id,gen_random_uuid() brand_id,gen_random_uuid() other_brand_id,
       null::uuid plan_id,null::uuid content_id;
grant select,update on planner_test_context to authenticated;

insert into auth.users(id,email)
select owner_id,'planner-owner@example.invalid' from planner_test_context union all
select worker_id,'planner-worker@example.invalid' from planner_test_context union all
select outsider_id,'planner-outsider@example.invalid' from planner_test_context;
insert into public.organizations(id,name,slug,created_by) select org_id,'Planner rollback test',org_id::text,owner_id from planner_test_context;
insert into public.memberships(organization_id,user_id,role)
select org_id,owner_id,'owner'::public.member_role from planner_test_context union all
select org_id,worker_id,'uploader'::public.member_role from planner_test_context union all
select org_id,outsider_id,'viewer'::public.member_role from planner_test_context;
insert into public.brands(id,organization_id,name,slug,created_by)
select brand_id,org_id,'Planner Brand',brand_id::text,owner_id from planner_test_context union all
select other_brand_id,org_id,'Other Brand',other_brand_id::text,owner_id from planner_test_context;
insert into public.brand_memberships(brand_id,user_id,can_upload,can_edit,can_publish) select brand_id,worker_id,true,false,false from planner_test_context;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from planner_test_context),true);
do $$ declare ctx planner_test_context; plan public.content_plans;
begin
 select * into ctx from planner_test_context;
 plan:=public.create_content_plan(ctx.brand_id,'September promo','Tampilkan manfaat utama','sales','Promo bulanan','carousel',ctx.worker_id,now()+interval '2 days',now()+interval '4 days');
 if plan.status<>'idea' or plan.objective<>'sales' or plan.assignee_id<>ctx.worker_id then raise exception 'planner creation returned invalid data'; end if;
 update planner_test_context set plan_id=plan.id;
end $$;

select set_config('request.jwt.claim.sub',(select worker_id::text from planner_test_context),true);
do $$ declare ctx planner_test_context; plan public.content_plans; comment public.content_plan_comments; rejected boolean:=false;
begin
 select * into ctx from planner_test_context;
 if (select count(*) from public.content_plans where id=ctx.plan_id)<>1 then raise exception 'assigned worker cannot read plan'; end if;
 plan:=public.update_content_plan(ctx.plan_id,'September promo','Copy sudah dikerjakan','sales','Promo bulanan','carousel','copywriting',ctx.worker_id,now()+interval '2 days',now()+interval '4 days');
 if plan.status<>'copywriting' then raise exception 'assigned worker cannot update stage'; end if;
 comment:=public.add_content_plan_comment(ctx.plan_id,'Copy siap dicek oleh editor.');
 if comment.body<>'Copy siap dicek oleh editor.' then raise exception 'comment creation failed'; end if;
 begin perform public.update_content_plan(ctx.plan_id,plan.title,plan.brief,plan.objective,plan.content_pillar,plan.content_format,plan.status,null,plan.due_at,plan.planned_for);
 exception when others then if sqlerrm='only editors can change PIC' then rejected:=true; else raise; end if; end;
 if not rejected then raise exception 'worker changed PIC without edit permission'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select outsider_id::text from planner_test_context),true);
do $$ declare rejected boolean:=false;
begin
 if (select count(*) from public.content_plans)<>0 then raise exception 'RLS exposed unassigned brand plan'; end if;
 begin perform public.add_content_plan_comment((select plan_id from planner_test_context),'Unauthorized');
 exception when others then if sqlerrm='forbidden' then rejected:=true; else raise; end if; end;
 if not rejected then raise exception 'outsider added a plan comment'; end if;
end $$;

reset role;
with created as (
 insert into public.content_items(id,brand_id,created_by,title,caption,media_type,primary_asset_path,status,approval_status)
 select gen_random_uuid(),brand_id,owner_id,'Linked content','Caption','image'::public.media_kind,'fixture/planner.jpg','ready'::public.content_status,'pending_review' from planner_test_context returning id
) update planner_test_context set content_id=(select id from created);

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from planner_test_context),true);
do $$ declare linked public.content_plans;
begin
 linked:=public.link_content_plan((select plan_id from planner_test_context),(select content_id from planner_test_context));
 if linked.status<>'review' or linked.content_item_id is null then raise exception 'content link did not synchronize plan'; end if;
end $$;

reset role;
update public.content_items set approval_status='approved',status='scheduled' where id=(select content_id from planner_test_context);
do $$ begin
 if (select status from public.content_plans where id=(select plan_id from planner_test_context))<>'scheduled' then raise exception 'linked content trigger did not synchronize plan status'; end if;
 if has_table_privilege('authenticated','public.content_plans','insert') or has_table_privilege('authenticated','public.content_plans','update') or has_table_privilege('authenticated','public.content_plan_comments','insert') then raise exception 'planner tables expose direct mutation privileges'; end if;
 if has_function_privilege('anon','public.create_content_plan(uuid,text,text,text,text,text,uuid,timestamptz,timestamptz)','execute') or has_function_privilege('anon','public.update_content_plan(uuid,text,text,text,text,text,text,uuid,timestamptz,timestamptz)','execute') or has_function_privilege('anon','public.add_content_plan_comment(uuid,text)','execute') or has_function_privilege('anon','public.link_content_plan(uuid,uuid)','execute') then raise exception 'anonymous planner mutation access allowed'; end if;
end $$;
select (select count(*)=1 from public.content_plans where id=(select plan_id from planner_test_context)) plan_created,
       (select count(*)=1 from public.content_plan_comments where plan_id=(select plan_id from planner_test_context)) comment_recorded,
       (select count(*)>=4 from public.activity_logs where entity_id=(select plan_id::text from planner_test_context)) activity_recorded,
       'planner creation, assignment, stage update, comment, RLS, content link and anonymous denial passed' checks;
rollback;
