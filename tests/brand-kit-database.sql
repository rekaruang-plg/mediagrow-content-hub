-- Run with the database admin connection. Every fixture and write is rolled back.
begin;

create temporary table brand_kit_test_context as
select gen_random_uuid() owner_id, gen_random_uuid() outsider_id,
       gen_random_uuid() org_id, gen_random_uuid() other_org_id,
       gen_random_uuid() brand_id, gen_random_uuid() other_brand_id;
grant select on brand_kit_test_context to authenticated;

insert into auth.users(id)
select owner_id from brand_kit_test_context union all
select outsider_id from brand_kit_test_context;

insert into public.organizations(id,name,slug,created_by)
select org_id,'Brand Kit rollback test',org_id::text,owner_id from brand_kit_test_context union all
select other_org_id,'Brand Kit outsider test',other_org_id::text,outsider_id from brand_kit_test_context;

insert into public.memberships(organization_id,user_id,role)
select org_id,owner_id,'owner'::public.member_role from brand_kit_test_context union all
select other_org_id,outsider_id,'owner'::public.member_role from brand_kit_test_context;

insert into public.brands(id,organization_id,name,slug,created_by)
select brand_id,org_id,'Brand Kit test brand',brand_id::text,owner_id from brand_kit_test_context union all
select other_brand_id,other_org_id,'Other Brand Kit brand',other_brand_id::text,outsider_id from brand_kit_test_context;

insert into public.brand_rules(brand_id)
select brand_id from brand_kit_test_context union all
select other_brand_id from brand_kit_test_context;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from brand_kit_test_context),true);

do $$
declare
  ctx brand_kit_test_context;
  updated public.brand_rules;
  rejected boolean := false;
begin
  select * into ctx from brand_kit_test_context;
  updated := public.update_brand_kit(
    ctx.brand_id,
    'Hangat dan informatif',
    'Konsultasikan kebutuhanmu',
    'Pemilik rumah',
    '#interior #palembang',
    'Jangan menjanjikan hasil instan',
    '["Edukasi","Portofolio"]'::jsonb
  );
  if updated.tone <> 'Hangat dan informatif' or jsonb_array_length(updated.content_pillars) <> 2 then
    raise exception 'brand kit update failed';
  end if;
  if not exists(select 1 from public.activity_logs where brand_id=ctx.brand_id and action='brand.kit_updated') then
    raise exception 'brand kit activity missing';
  end if;

  begin
    perform public.update_brand_kit(ctx.other_brand_id,'Forbidden',null,null,null,null,'[]'::jsonb);
  exception when others then
    if sqlerrm='forbidden' then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'cross-workspace brand kit update allowed'; end if;
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon','public.update_brand_kit(uuid,text,text,text,text,text,jsonb)','execute') then
    raise exception 'anonymous brand kit update allowed';
  end if;
  if not has_function_privilege('authenticated','public.update_brand_kit(uuid,text,text,text,text,text,jsonb)','execute') then
    raise exception 'authenticated brand kit update grant missing';
  end if;
end $$;

select
  (select tone='Hangat dan informatif' and jsonb_array_length(content_pillars)=2
   from public.brand_rules where brand_id=(select brand_id from brand_kit_test_context)) as brand_kit_saved,
  (select count(*)=1 from public.activity_logs
   where brand_id=(select brand_id from brand_kit_test_context) and action='brand.kit_updated') as activity_logged,
  'brand kit validation, cross-workspace denial, activity and anonymous denial passed' as checks;

rollback;
