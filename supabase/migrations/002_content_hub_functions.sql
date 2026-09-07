create or replace function private.is_org_member(org_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select (select auth.uid()) is not null and exists(select 1 from public.memberships m where m.organization_id=org_id and m.user_id=(select auth.uid())) $$;
create or replace function private.has_org_role(org_id uuid,roles text[]) returns boolean language sql stable security definer set search_path='' as $$ select (select auth.uid()) is not null and exists(select 1 from public.memberships m where m.organization_id=org_id and m.user_id=(select auth.uid()) and m.role::text=any(roles)) $$;
create or replace function private.brand_org(target_brand uuid) returns uuid language sql stable security definer set search_path='' as $$ select b.organization_id from public.brands b where b.id=target_brand $$;
create or replace function private.can_access_brand(target_brand uuid) returns boolean language sql stable security definer set search_path='' as $$ select (select auth.uid()) is not null and exists(select 1 from public.brands b join public.memberships m on m.organization_id=b.organization_id and m.user_id=(select auth.uid()) left join public.brand_memberships bm on bm.brand_id=b.id and bm.user_id=(select auth.uid()) where b.id=target_brand and (m.role in ('owner','admin') or bm.user_id is not null or m.role in ('editor','uploader','viewer'))) $$;
create or replace function private.can_upload_brand(target_brand uuid) returns boolean language sql stable security definer set search_path='' as $$ select (select auth.uid()) is not null and exists(select 1 from public.brands b join public.memberships m on m.organization_id=b.organization_id and m.user_id=(select auth.uid()) left join public.brand_memberships bm on bm.brand_id=b.id and bm.user_id=(select auth.uid()) where b.id=target_brand and (m.role in ('owner','admin','editor','uploader') or coalesce(bm.can_upload,false))) $$;
create or replace function private.can_edit_brand(target_brand uuid) returns boolean language sql stable security definer set search_path='' as $$ select (select auth.uid()) is not null and exists(select 1 from public.brands b join public.memberships m on m.organization_id=b.organization_id and m.user_id=(select auth.uid()) left join public.brand_memberships bm on bm.brand_id=b.id and bm.user_id=(select auth.uid()) where b.id=target_brand and (m.role in ('owner','admin','editor') or coalesce(bm.can_edit,false))) $$;
create or replace function private.can_publish_brand(target_brand uuid) returns boolean language sql stable security definer set search_path='' as $$ select (select auth.uid()) is not null and exists(select 1 from public.brands b join public.memberships m on m.organization_id=b.organization_id and m.user_id=(select auth.uid()) left join public.brand_memberships bm on bm.brand_id=b.id and bm.user_id=(select auth.uid()) where b.id=target_brand and (m.role in ('owner','admin','editor') or coalesce(bm.can_publish,false))) $$;

create or replace function public.bootstrap_workspace(org_name text default 'MediaGrow') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); org_id uuid; base_slug text;
begin
 if uid is null then raise exception 'unauthorized'; end if;
 insert into public.profiles(id,display_name) values(uid,coalesce((select raw_user_meta_data->>'full_name' from auth.users where id=uid),(select email from auth.users where id=uid))) on conflict(id) do nothing;
 select m.organization_id into org_id from public.memberships m where m.user_id=uid order by m.created_at limit 1;
 if org_id is null then
   base_slug:=lower(regexp_replace(coalesce(nullif(trim(org_name),''),'mediagrow'),'[^a-zA-Z0-9]+','-','g'))||'-'||substr(uid::text,1,8);
   insert into public.organizations(name,slug,created_by) values(coalesce(nullif(trim(org_name),''),'MediaGrow'),base_slug,uid) returning id into org_id;
   insert into public.memberships(organization_id,user_id,role) values(org_id,uid,'owner');
 end if;
 return jsonb_build_object('organization_id',org_id);
end $$;

create or replace function public.create_brand(p_name text,p_niche text default null,p_timezone text default 'Asia/Jakarta') returns public.brands language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); org_id uuid; result public.brands; slug_base text;
begin
 if uid is null then raise exception 'unauthorized'; end if;
 select m.organization_id into org_id from public.memberships m where m.user_id=uid and m.role in ('owner','admin') order by m.created_at limit 1;
 if org_id is null then raise exception 'forbidden'; end if;
 slug_base:=trim(both '-' from lower(regexp_replace(coalesce(nullif(trim(p_name),''),'brand'),'[^a-zA-Z0-9]+','-','g')));
 insert into public.brands(organization_id,name,slug,niche,timezone,created_by) values(org_id,p_name,slug_base||'-'||substr(gen_random_uuid()::text,1,5),p_niche,coalesce(nullif(p_timezone,''),'Asia/Jakarta'),uid) returning * into result;
 insert into public.brand_rules(brand_id,timezone) values(result.id,result.timezone) on conflict(brand_id) do nothing;
 return result;
end $$;

create or replace function public.connect_social_account(p_brand_id uuid,p_platform public.social_platform,p_external_account_id text,p_access_token text,p_username text default null,p_display_name text default null,p_token_expires_at timestamptz default null,p_capabilities jsonb default '{}'::jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare org_id uuid; key_text text; account_id uuid;
begin
 if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
 select b.organization_id into org_id from public.brands b where b.id=p_brand_id;
 if org_id is null or not private.has_org_role(org_id,array['owner','admin']) then raise exception 'forbidden'; end if;
 if nullif(trim(p_access_token),'') is null then raise exception 'access token required'; end if;
 select s.value into key_text from private.app_secrets s where s.key='token_key';
 insert into public.social_accounts(brand_id,platform,external_account_id,username,display_name,access_token_encrypted,token_expires_at,capabilities,status,last_verified_at)
 values(p_brand_id,p_platform,p_external_account_id,p_username,p_display_name,extensions.pgp_sym_encrypt(p_access_token,key_text,'cipher-algo=aes256'),p_token_expires_at,coalesce(p_capabilities,'{}'::jsonb),'connected',now())
 on conflict(brand_id,platform,external_account_id) do update set username=excluded.username,display_name=excluded.display_name,access_token_encrypted=excluded.access_token_encrypted,token_expires_at=excluded.token_expires_at,capabilities=excluded.capabilities,status='connected',last_verified_at=now(),updated_at=now()
 returning id into account_id;
 return account_id;
end $$;

create or replace function public.schedule_content(p_content_id uuid,p_channels text[],p_scheduled_for timestamptz default null) returns setof public.publish_jobs language plpgsql security definer set search_path='' as $$
declare c public.content_items; rules public.brand_rules; ch text; platform_val public.social_platform; kind_val public.publish_kind; account_id uuid; candidate timestamptz; day_offset int; slot jsonb; time_text text; local_date date; min_gap int; inserted_count int:=0;
begin
 select * into c from public.content_items where id=p_content_id;
 if c.id is null then raise exception 'content not found'; end if;
 if not private.can_publish_brand(c.brand_id) then raise exception 'forbidden'; end if;
 select * into rules from public.brand_rules where brand_id=c.brand_id;
 min_gap:=coalesce(rules.min_gap_minutes,180); candidate:=p_scheduled_for;
 if candidate is null then
   <<days_loop>> for day_offset in 0..30 loop
     local_date:=(now() at time zone coalesce(rules.timezone,'Asia/Jakarta'))::date+day_offset;
     for slot in select value from jsonb_array_elements(coalesce(rules.posting_windows,'[]'::jsonb)) loop
       if (slot->>'day')::int=extract(dow from local_date)::int then
         for time_text in select jsonb_array_elements_text(slot->'times') loop
           candidate:=((local_date::text||' '||time_text)::timestamp at time zone coalesce(rules.timezone,'Asia/Jakarta'));
           if candidate>now() and not exists(select 1 from public.publish_jobs j join public.content_items ci on ci.id=j.content_item_id where ci.brand_id=c.brand_id and j.status in ('scheduled','retrying','publishing') and abs(extract(epoch from(j.scheduled_for-candidate)))<min_gap*60) then exit days_loop; end if;
           candidate:=null;
         end loop;
       end if;
     end loop;
   end loop;
 end if;
 if candidate is null then raise exception 'no posting slot available'; end if;
 foreach ch in array p_channels loop
   case ch when 'ig_feed' then platform_val:='instagram';kind_val:='feed'; when 'ig_story' then platform_val:='instagram';kind_val:='story'; when 'ig_reel' then platform_val:='instagram';kind_val:='reel'; when 'fb_feed' then platform_val:='facebook';kind_val:='feed'; when 'fb_story' then platform_val:='facebook';kind_val:='story'; when 'fb_reel' then platform_val:='facebook';kind_val:='reel'; else continue; end case;
   if kind_val='reel' and c.media_type<>'video' then continue; end if;
   select s.id into account_id from public.social_accounts s where s.brand_id=c.brand_id and s.platform=platform_val and s.status='connected' order by s.updated_at desc limit 1;
   if account_id is null then continue; end if;
   insert into public.publish_jobs(content_item_id,social_account_id,platform,publish_kind,scheduled_for,status) values(c.id,account_id,platform_val,kind_val,candidate,'scheduled')
   on conflict(content_item_id,social_account_id,publish_kind) do update set scheduled_for=excluded.scheduled_for,status='scheduled',error_message=null,updated_at=now();
   inserted_count:=inserted_count+1;
 end loop;
 if inserted_count=0 then raise exception 'no connected account for selected channels'; end if;
 update public.content_items set status='scheduled' where id=c.id;
 return query select * from public.publish_jobs j where j.content_item_id=c.id order by j.created_at;
end $$;

create or replace function public.claim_due_publish_jobs(p_batch_size int default 6) returns setof public.publish_jobs language plpgsql security definer set search_path='' as $$
begin return query with picked as(select j.id from public.publish_jobs j where j.status in('scheduled','retrying') and j.scheduled_for<=now() and j.attempts<4 order by j.scheduled_for for update skip locked limit greatest(1,least(coalesce(p_batch_size,6),12))), upd as(update public.publish_jobs j set status='publishing',attempts=j.attempts+1,last_attempt_at=now(),updated_at=now() from picked p where j.id=p.id returning j.*) select * from upd; end $$;
create or replace function public.worker_get_social_token(p_account_id uuid) returns text language sql security definer set search_path='' as $$ select extensions.pgp_sym_decrypt(s.access_token_encrypted,(select value from private.app_secrets where key='token_key')) from public.social_accounts s where s.id=p_account_id and s.status='connected' $$;
create or replace function public.worker_secret_matches(p_candidate text) returns boolean language sql security definer set search_path='' as $$ select coalesce(p_candidate,'')=(select value from private.app_secrets where key='worker_http_secret') $$;
create or replace function public.worker_graph_version() returns text language sql security definer set search_path='' as $$ select value from private.app_secrets where key='meta_graph_version' $$;
