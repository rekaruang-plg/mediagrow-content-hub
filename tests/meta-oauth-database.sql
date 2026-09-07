-- Run with the database admin connection. Every fixture and write is rolled back.
begin;
create temporary table meta_oauth_test_context as
select gen_random_uuid() owner_id, gen_random_uuid() editor_id, gen_random_uuid() other_id,
       gen_random_uuid() org_id, gen_random_uuid() other_org_id,
       gen_random_uuid() brand_id, gen_random_uuid() other_brand_id;
grant select on meta_oauth_test_context to authenticated;
insert into auth.users(id)
select owner_id from meta_oauth_test_context union all
select editor_id from meta_oauth_test_context union all
select other_id from meta_oauth_test_context;
insert into public.organizations(id,name,slug,created_by)
select org_id,'OAuth rollback test',org_id::text,owner_id from meta_oauth_test_context union all
select other_org_id,'Other rollback test',other_org_id::text,other_id from meta_oauth_test_context;
insert into public.memberships(organization_id,user_id,role)
select org_id,owner_id,'owner'::public.member_role from meta_oauth_test_context union all
select org_id,editor_id,'editor'::public.member_role from meta_oauth_test_context union all
select other_org_id,other_id,'owner'::public.member_role from meta_oauth_test_context;
insert into public.brands(id,organization_id,name,slug,created_by)
select brand_id,org_id,'OAuth test brand',brand_id::text,owner_id from meta_oauth_test_context union all
select other_brand_id,other_org_id,'Other test brand',other_brand_id::text,other_id from meta_oauth_test_context;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from meta_oauth_test_context),true);
do $$
declare ids uuid[]; target uuid; other_target uuid; rejected boolean;
begin
  select brand_id,other_brand_id into target,other_target from meta_oauth_test_context;
  ids := public.connect_meta_accounts(target,'[{"platform":"facebook","external_account_id":"101","access_token":"fixture-token"},{"platform":"instagram","external_account_id":"202","access_token":"fixture-token"}]');
  if array_length(ids,1) <> 2 then raise exception 'owner save failed'; end if;
  perform public.connect_meta_accounts(target,'[{"platform":"facebook","external_account_id":"101","access_token":"fixture-token"},{"platform":"instagram","external_account_id":"202","access_token":"fixture-token"}]');
  if (select count(*) from public.social_accounts where brand_id=target) <> 2 then raise exception 'reconnect created duplicates'; end if;
  rejected := false;
  begin
    perform public.connect_meta_accounts(target,'[{"platform":"facebook","external_account_id":"303","access_token":"fixture-token"},{"platform":"invalid","external_account_id":"404","access_token":"fixture-token"}]');
  exception when others then
    if sqlerrm='invalid account' then rejected := true; else raise; end if;
  end;
  if not rejected or exists(select 1 from public.social_accounts where brand_id=target and external_account_id='303') then raise exception 'batch was not atomic'; end if;
  rejected := false;
  begin
    perform public.connect_meta_accounts(target,'[{"platform":"facebook","external_account_id":"505","access_token":"fixture-token"},{"platform":"facebook","external_account_id":"606","access_token":"fixture-token"}]');
  exception when others then
    if sqlerrm='only one account per platform per request' then rejected := true; else raise; end if;
  end;
  if not rejected or exists(select 1 from public.social_accounts where brand_id=target and external_account_id='505') then raise exception 'duplicate platform was not atomic'; end if;
  rejected := false;
  begin
    perform public.connect_meta_accounts(other_target,'[{"platform":"facebook","external_account_id":"707","access_token":"fixture-token"}]');
  exception when others then
    if sqlerrm='forbidden' then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'cross-organization access allowed'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select editor_id::text from meta_oauth_test_context),true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.connect_meta_accounts((select brand_id from meta_oauth_test_context),'[{"platform":"facebook","external_account_id":"808","access_token":"fixture-token"}]');
  exception when others then
    if sqlerrm='forbidden' then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'editor was allowed to connect'; end if;
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon','public.connect_meta_accounts(uuid,jsonb)','execute') then raise exception 'anonymous RPC access allowed'; end if;
  if not has_function_privilege('authenticated','public.connect_meta_accounts(uuid,jsonb)','execute') then raise exception 'authenticated RPC grant missing'; end if;
  if (select prosecdef from pg_proc where oid='public.connect_meta_accounts(uuid,jsonb)'::regprocedure) then raise exception 'wrapper unexpectedly bypasses caller privileges'; end if;
end $$;
select
  (select count(*)=2 from public.social_accounts where brand_id=(select brand_id from meta_oauth_test_context)) as saved_exactly_two_accounts,
  (select bool_and(extensions.pgp_sym_decrypt(access_token_encrypted,(select value from private.app_secrets where key='token_key'))='fixture-token') from public.social_accounts where brand_id=(select brand_id from meta_oauth_test_context)) as encrypted_tokens_roundtrip,
  (select count(*)=0 from public.social_accounts where brand_id=(select other_brand_id from meta_oauth_test_context)) as other_brand_unchanged,
  (select count(*)=0 from public.publish_jobs j join public.content_items c on c.id=j.content_item_id where c.brand_id in(select brand_id from meta_oauth_test_context union all select other_brand_id from meta_oauth_test_context)) as no_publish_jobs,
  'owner, reconnect, atomic rollback, cross-org denial, editor denial, anonymous denial and invoker checks passed' as checks;
rollback;
