alter table public.profiles enable row level security; alter table public.organizations enable row level security; alter table public.memberships enable row level security; alter table public.brands enable row level security; alter table public.brand_memberships enable row level security; alter table public.brand_rules enable row level security; alter table public.social_accounts enable row level security; alter table public.content_items enable row level security; alter table public.content_assets enable row level security; alter table public.publish_jobs enable row level security; alter table public.activity_logs enable row level security;

grant usage on schema public to anon,authenticated;
grant select,insert,update,delete on public.profiles,public.organizations,public.memberships,public.brands,public.brand_memberships,public.brand_rules,public.content_items,public.content_assets,public.publish_jobs to authenticated;
grant select on public.social_accounts,public.activity_logs to authenticated; grant usage,select on all sequences in schema public to authenticated;

do $$ begin
 drop policy if exists "profiles self" on public.profiles; create policy "profiles self" on public.profiles for select to authenticated using((select auth.uid())=id);
 drop policy if exists "profiles update self" on public.profiles; create policy "profiles update self" on public.profiles for update to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
 drop policy if exists "org read members" on public.organizations; create policy "org read members" on public.organizations for select to authenticated using(private.is_org_member(id));
 drop policy if exists "org update admins" on public.organizations; create policy "org update admins" on public.organizations for update to authenticated using(private.has_org_role(id,array['owner','admin'])) with check(private.has_org_role(id,array['owner','admin']));
 drop policy if exists "memberships read org" on public.memberships; create policy "memberships read org" on public.memberships for select to authenticated using(private.is_org_member(organization_id));
 drop policy if exists "memberships manage owner" on public.memberships; create policy "memberships manage owner" on public.memberships for all to authenticated using(private.has_org_role(organization_id,array['owner'])) with check(private.has_org_role(organization_id,array['owner']));
 drop policy if exists "brands read org" on public.brands; create policy "brands read org" on public.brands for select to authenticated using(private.can_access_brand(id));
 drop policy if exists "brands update admin" on public.brands; create policy "brands update admin" on public.brands for update to authenticated using(private.has_org_role(organization_id,array['owner','admin'])) with check(private.has_org_role(organization_id,array['owner','admin']));
 drop policy if exists "brand membership read" on public.brand_memberships; create policy "brand membership read" on public.brand_memberships for select to authenticated using(private.can_access_brand(brand_id));
 drop policy if exists "brand membership manage" on public.brand_memberships; create policy "brand membership manage" on public.brand_memberships for all to authenticated using(private.has_org_role(private.brand_org(brand_id),array['owner','admin'])) with check(private.has_org_role(private.brand_org(brand_id),array['owner','admin']));
 drop policy if exists "rules read" on public.brand_rules; create policy "rules read" on public.brand_rules for select to authenticated using(private.can_access_brand(brand_id));
 drop policy if exists "rules edit" on public.brand_rules; create policy "rules edit" on public.brand_rules for update to authenticated using(private.can_edit_brand(brand_id)) with check(private.can_edit_brand(brand_id));
 drop policy if exists "social read admin" on public.social_accounts; create policy "social read admin" on public.social_accounts for select to authenticated using(private.has_org_role(private.brand_org(brand_id),array['owner','admin']));
 drop policy if exists "content read" on public.content_items; create policy "content read" on public.content_items for select to authenticated using(private.can_access_brand(brand_id));
 drop policy if exists "content insert" on public.content_items; create policy "content insert" on public.content_items for insert to authenticated with check((select auth.uid())=created_by and private.can_upload_brand(brand_id));
 drop policy if exists "content update" on public.content_items; create policy "content update" on public.content_items for update to authenticated using(private.can_edit_brand(brand_id)) with check(private.can_edit_brand(brand_id));
 drop policy if exists "content delete" on public.content_items; create policy "content delete" on public.content_items for delete to authenticated using(private.can_edit_brand(brand_id));
 drop policy if exists "assets read" on public.content_assets; create policy "assets read" on public.content_assets for select to authenticated using(exists(select 1 from public.content_items c where c.id=content_item_id and private.can_access_brand(c.brand_id)));
 drop policy if exists "assets insert" on public.content_assets; create policy "assets insert" on public.content_assets for insert to authenticated with check(exists(select 1 from public.content_items c where c.id=content_item_id and private.can_upload_brand(c.brand_id)));
 drop policy if exists "jobs read" on public.publish_jobs; create policy "jobs read" on public.publish_jobs for select to authenticated using(exists(select 1 from public.content_items c where c.id=content_item_id and private.can_access_brand(c.brand_id)));
 drop policy if exists "activity read" on public.activity_logs; create policy "activity read" on public.activity_logs for select to authenticated using(private.is_org_member(organization_id));
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('content-media','content-media',false,1073741824,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
do $$ begin
 drop policy if exists "content hub media read" on storage.objects; create policy "content hub media read" on storage.objects for select to authenticated using(bucket_id='content-media' and exists(select 1 from public.brands b where b.id::text=(storage.foldername(storage.objects.name))[1] and private.can_access_brand(b.id)));
 drop policy if exists "content hub media insert" on storage.objects; create policy "content hub media insert" on storage.objects for insert to authenticated with check(bucket_id='content-media' and exists(select 1 from public.brands b where b.id::text=(storage.foldername(storage.objects.name))[1] and private.can_upload_brand(b.id)));
 drop policy if exists "content hub media update" on storage.objects; create policy "content hub media update" on storage.objects for update to authenticated using(bucket_id='content-media' and exists(select 1 from public.brands b where b.id::text=(storage.foldername(storage.objects.name))[1] and private.can_edit_brand(b.id))) with check(bucket_id='content-media' and exists(select 1 from public.brands b where b.id::text=(storage.foldername(storage.objects.name))[1] and private.can_edit_brand(b.id)));
 drop policy if exists "content hub media delete" on storage.objects; create policy "content hub media delete" on storage.objects for delete to authenticated using(bucket_id='content-media' and exists(select 1 from public.brands b where b.id::text=(storage.foldername(storage.objects.name))[1] and private.can_edit_brand(b.id)));
end $$;

revoke execute on all functions in schema private from public,anon,authenticated;
revoke usage on schema private from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid),private.has_org_role(uuid,text[]),private.brand_org(uuid),private.can_access_brand(uuid),private.can_upload_brand(uuid),private.can_edit_brand(uuid),private.can_publish_brand(uuid) to authenticated;
revoke execute on function public.claim_due_publish_jobs(int),public.worker_get_social_token(uuid),public.worker_secret_matches(text),public.worker_graph_version() from public,anon,authenticated;
grant execute on function public.claim_due_publish_jobs(int),public.worker_get_social_token(uuid),public.worker_secret_matches(text),public.worker_graph_version() to service_role;
revoke execute on function public.bootstrap_workspace(text),public.create_brand(text,text,text),public.connect_social_account(uuid,public.social_platform,text,text,text,text,timestamptz,jsonb),public.schedule_content(uuid,text[],timestamptz) from public,anon;
grant execute on function public.bootstrap_workspace(text),public.create_brand(text,text,text),public.connect_social_account(uuid,public.social_platform,text,text,text,text,timestamptz,jsonb),public.schedule_content(uuid,text[],timestamptz) to authenticated;
