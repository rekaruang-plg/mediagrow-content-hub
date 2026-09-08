-- Internal team operations: approvals, safe calendar controls, audit history,
-- and invitation-based brand access. Existing Meta accounts and published jobs
-- are intentionally left untouched.

alter table public.content_items
  add column if not exists approval_status text not null default 'draft'
    check (approval_status in ('draft','pending_review','changes_requested','approved')),
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

update public.content_items
set approval_status = 'approved'
where status in ('scheduled','publishing','posted','failed')
  and approval_status <> 'approved';

create index if not exists idx_content_approval
  on public.content_items(brand_id, approval_status, created_at desc);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.member_role not null,
  brand_ids uuid[] not null default '{}'::uuid[],
  token_hash bytea not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (role <> 'owner'),
  check (email = lower(trim(email)))
);

create index if not exists idx_workspace_invitations_active
  on public.workspace_invitations(organization_id, expires_at desc)
  where accepted_at is null and revoked_at is null;

alter table public.workspace_invitations enable row level security;
revoke all on public.workspace_invitations from public, anon, authenticated;

-- Brand access is explicit for non-admin team members. Owners and admins keep
-- workspace-wide access; editors, uploaders, and viewers only see assigned brands.
create or replace function private.can_access_brand(target_brand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists(
    select 1
    from public.brands b
    join public.memberships m
      on m.organization_id = b.organization_id
     and m.user_id = (select auth.uid())
    left join public.brand_memberships bm
      on bm.brand_id = b.id
     and bm.user_id = (select auth.uid())
    where b.id = target_brand
      and (m.role in ('owner','admin') or bm.user_id is not null)
  )
$$;

create or replace function private.can_upload_brand(target_brand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists(
    select 1
    from public.brands b
    join public.memberships m
      on m.organization_id = b.organization_id
     and m.user_id = (select auth.uid())
    left join public.brand_memberships bm
      on bm.brand_id = b.id
     and bm.user_id = (select auth.uid())
    where b.id = target_brand
      and (m.role in ('owner','admin') or coalesce(bm.can_upload, false))
  )
$$;

create or replace function private.can_edit_brand(target_brand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists(
    select 1
    from public.brands b
    join public.memberships m
      on m.organization_id = b.organization_id
     and m.user_id = (select auth.uid())
    left join public.brand_memberships bm
      on bm.brand_id = b.id
     and bm.user_id = (select auth.uid())
    where b.id = target_brand
      and (m.role in ('owner','admin') or coalesce(bm.can_edit, false))
  )
$$;

create or replace function private.can_publish_brand(target_brand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists(
    select 1
    from public.brands b
    join public.memberships m
      on m.organization_id = b.organization_id
     and m.user_id = (select auth.uid())
    left join public.brand_memberships bm
      on bm.brand_id = b.id
     and bm.user_id = (select auth.uid())
    where b.id = target_brand
      and (m.role in ('owner','admin') or coalesce(bm.can_publish, false))
  )
$$;

create or replace function private.write_activity(
  p_brand_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_details jsonb default '{}'::jsonb,
  p_user_id uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  org_id uuid;
begin
  select b.organization_id into org_id from public.brands b where b.id = p_brand_id;
  if org_id is null then return; end if;
  insert into public.activity_logs(organization_id, brand_id, user_id, action, entity_type, entity_id, details)
  values(org_id, p_brand_id, coalesce(p_user_id, (select auth.uid())), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

revoke execute on function private.write_activity(uuid,text,text,text,jsonb,uuid) from public, anon, authenticated;

drop policy if exists "content insert" on public.content_items;
create policy "content insert" on public.content_items for insert to authenticated
with check(
  (select auth.uid()) = created_by
  and private.can_upload_brand(brand_id)
  and (
    approval_status in ('draft','pending_review')
    or (
      approval_status = 'approved'
      and private.can_publish_brand(brand_id)
      and not coalesce((select r.approval_required from public.brand_rules r where r.brand_id = content_items.brand_id), false)
    )
  )
);

-- Approval fields may only change through the secured workflow functions below.
revoke update on public.content_items from authenticated;

create or replace function public.update_content_details(
  p_content_id uuid,
  p_title text,
  p_brief text default null,
  p_caption text default null
) returns public.content_items
language plpgsql security definer set search_path = '' as $$
declare
  item public.content_items;
  result public.content_items;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select * into item from public.content_items where id = p_content_id;
  if item.id is null then raise exception 'content not found'; end if;
  if not private.can_edit_brand(item.brand_id)
     and not (item.created_by = (select auth.uid()) and item.approval_status in ('draft','changes_requested')) then
    raise exception 'forbidden';
  end if;
  if item.status in ('publishing','posted') then raise exception 'published content cannot be edited'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'title is required'; end if;

  update public.content_items
  set title = trim(p_title),
      brief = nullif(trim(coalesce(p_brief, '')), ''),
      caption = nullif(trim(coalesce(p_caption, '')), ''),
      approval_status = case when approval_status = 'changes_requested' then 'draft' else approval_status end,
      review_note = case when approval_status = 'changes_requested' then null else review_note end,
      reviewed_by = case when approval_status = 'changes_requested' then null else reviewed_by end,
      reviewed_at = case when approval_status = 'changes_requested' then null else reviewed_at end,
      updated_at = now()
  where id = item.id
  returning * into result;

  perform private.write_activity(item.brand_id, 'content.updated', 'content_item', item.id::text, jsonb_build_object('title', result.title));
  return result;
end;
$$;

create or replace function public.submit_content_for_review(p_content_id uuid)
returns public.content_items
language plpgsql security definer set search_path = '' as $$
declare
  item public.content_items;
  result public.content_items;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select * into item from public.content_items where id = p_content_id;
  if item.id is null then raise exception 'content not found'; end if;
  if not private.can_upload_brand(item.brand_id) then raise exception 'forbidden'; end if;
  if item.status in ('publishing','posted') then raise exception 'published content cannot be reviewed'; end if;

  update public.content_items
  set approval_status = 'pending_review', review_note = null, reviewed_by = null, reviewed_at = null, updated_at = now()
  where id = item.id
  returning * into result;
  perform private.write_activity(item.brand_id, 'content.submitted', 'content_item', item.id::text, '{}'::jsonb);
  return result;
end;
$$;

-- Replace the scheduling RPC so required approvals cannot be bypassed by a
-- direct Data API call. Non-review brands continue to schedule immediately.
create or replace function public.schedule_content_hybrid(
  p_content_id uuid,
  p_channels text[],
  p_mode text default 'smart',
  p_scheduled_for timestamptz default null
) returns setof public.publish_jobs
language plpgsql security definer set search_path = '' as $$
declare
  content_row public.content_items;
  rules public.brand_rules;
  channel_value text;
  mode_value text := lower(coalesce(p_mode, 'smart'));
  platform_value public.social_platform;
  kind_value public.publish_kind;
  account_id uuid;
  candidate timestamptz;
  inserted_count integer := 0;
  reason text;
begin
  select * into content_row from public.content_items where id = p_content_id;
  if content_row.id is null then raise exception 'content not found'; end if;
  if not private.can_publish_brand(content_row.brand_id) then raise exception 'forbidden'; end if;
  if coalesce(array_length(p_channels, 1), 0) = 0 then raise exception 'select at least one channel'; end if;
  if mode_value not in ('manual', 'auto', 'smart') then raise exception 'invalid schedule mode'; end if;

  select * into rules from public.brand_rules where brand_id = content_row.brand_id;
  if rules.brand_id is null then raise exception 'brand schedule rules not found'; end if;
  if rules.approval_required and content_row.approval_status <> 'approved' then
    raise exception 'content requires approval';
  end if;

  if mode_value = 'manual' then
    if p_scheduled_for is null or p_scheduled_for <= now() then raise exception 'manual schedule must be in the future'; end if;
    candidate := p_scheduled_for;
    reason := 'Waktu dipilih manual oleh tim.';
  else
    if not rules.autopilot_enabled then raise exception 'autopilot is disabled for this brand'; end if;
    candidate := private.pick_schedule_slot(content_row.brand_id, mode_value);
    reason := case mode_value
      when 'smart' then 'Slot terbaik dari aturan brand, histori publikasi berhasil, dan antrean aktif.'
      else 'Slot kosong terdekat dari aturan jadwal brand.'
    end;
  end if;

  foreach channel_value in array p_channels loop
    case channel_value
      when 'ig_feed' then platform_value := 'instagram'; kind_value := 'feed';
      when 'ig_story' then platform_value := 'instagram'; kind_value := 'story';
      when 'ig_reel' then platform_value := 'instagram'; kind_value := 'reel';
      when 'fb_feed' then platform_value := 'facebook'; kind_value := 'feed';
      when 'fb_story' then platform_value := 'facebook'; kind_value := 'story';
      when 'fb_reel' then platform_value := 'facebook'; kind_value := 'reel';
      else continue;
    end case;
    if kind_value = 'reel' and content_row.media_type <> 'video' then continue; end if;

    select s.id into account_id
    from public.social_accounts s
    where s.brand_id = content_row.brand_id and s.platform = platform_value and s.status = 'connected'
    order by s.updated_at desc limit 1;
    if account_id is null then continue; end if;

    insert into public.publish_jobs(content_item_id, social_account_id, platform, publish_kind, scheduled_for, status, metadata)
    values(content_row.id, account_id, platform_value, kind_value, candidate, 'scheduled', jsonb_build_object(
      'schedule_mode', mode_value, 'schedule_reason', reason, 'timezone', coalesce(rules.timezone, 'Asia/Jakarta')
    ))
    on conflict(content_item_id, social_account_id, publish_kind) do update
    set scheduled_for = excluded.scheduled_for, status = 'scheduled', attempts = 0,
        error_message = null, metadata = excluded.metadata, updated_at = now();
    inserted_count := inserted_count + 1;
  end loop;

  if inserted_count = 0 then raise exception 'no connected account for selected channels'; end if;

  update public.content_items
  set status = 'scheduled', approval_status = 'approved', auto_schedule = mode_value <> 'manual',
      ai_metadata = coalesce(ai_metadata, '{}'::jsonb) || jsonb_build_object(
        'schedule_mode', mode_value, 'scheduled_for', candidate, 'schedule_reason', reason
      ), updated_at = now()
  where id = content_row.id;

  perform private.write_activity(content_row.brand_id, 'content.scheduled', 'content_item', content_row.id::text,
    jsonb_build_object('mode', mode_value, 'scheduled_for', candidate, 'channels', p_channels));

  return query select * from public.publish_jobs j where j.content_item_id = content_row.id order by j.created_at;
end;
$$;

create or replace function public.review_content(
  p_content_id uuid,
  p_decision text,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item public.content_items;
  decision text := lower(coalesce(p_decision, ''));
  requested_channels text[];
  requested_mode text;
  requested_time timestamptz;
  schedule_error text;
  scheduled_count integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select * into item from public.content_items where id = p_content_id;
  if item.id is null then raise exception 'content not found'; end if;
  if not private.can_publish_brand(item.brand_id) then raise exception 'forbidden'; end if;
  if decision not in ('approved','changes_requested') then raise exception 'invalid review decision'; end if;
  if item.status in ('publishing','posted') then raise exception 'published content cannot be reviewed'; end if;

  if decision = 'changes_requested' then
    update public.publish_jobs set status = 'cancelled', updated_at = now()
    where content_item_id = item.id and status in ('scheduled','retrying');
    update public.content_items
    set approval_status = decision, review_note = nullif(trim(coalesce(p_note, '')), ''),
        reviewed_by = (select auth.uid()), reviewed_at = now(), status = 'ready', updated_at = now()
    where id = item.id;
  else
    update public.content_items
    set approval_status = decision, review_note = nullif(trim(coalesce(p_note, '')), ''),
        reviewed_by = (select auth.uid()), reviewed_at = now(), updated_at = now()
    where id = item.id;

    select coalesce(array_agg(value), '{}'::text[]) into requested_channels
    from jsonb_array_elements_text(coalesce(item.ai_metadata->'requested_channels', '[]'::jsonb));
    requested_mode := coalesce(nullif(item.ai_metadata->>'requested_schedule_mode', ''), 'smart');
    if nullif(item.ai_metadata->>'requested_scheduled_for', '') is not null then
      requested_time := (item.ai_metadata->>'requested_scheduled_for')::timestamptz;
    end if;

    if coalesce(array_length(requested_channels, 1), 0) > 0 then
      begin
        perform public.schedule_content_hybrid(item.id, requested_channels, requested_mode, requested_time);
        select count(*) into scheduled_count from public.publish_jobs where content_item_id = item.id and status = 'scheduled';
      exception when others then
        schedule_error := sqlerrm;
      end;
    end if;
  end if;

  perform private.write_activity(item.brand_id, 'content.reviewed', 'content_item', item.id::text,
    jsonb_build_object('decision', decision, 'note', p_note, 'schedule_error', schedule_error));
  return jsonb_build_object('content_id', item.id, 'decision', decision, 'scheduled_count', scheduled_count, 'schedule_error', schedule_error);
end;
$$;

create or replace function public.manage_publish_job(
  p_job_id uuid,
  p_action text,
  p_scheduled_for timestamptz default null
) returns public.publish_jobs
language plpgsql security definer set search_path = '' as $$
declare
  job public.publish_jobs;
  item public.content_items;
  action_value text := lower(coalesce(p_action, ''));
  result public.publish_jobs;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select * into job from public.publish_jobs where id = p_job_id for update;
  if job.id is null then raise exception 'job not found'; end if;
  select * into item from public.content_items where id = job.content_item_id;
  if not private.can_publish_brand(item.brand_id) then raise exception 'forbidden'; end if;
  if job.status in ('publishing','posted') then raise exception 'publishing or posted job cannot be changed'; end if;

  if action_value = 'reschedule' then
    if p_scheduled_for is null or p_scheduled_for <= now() then raise exception 'new schedule must be in the future'; end if;
    update public.publish_jobs set scheduled_for = p_scheduled_for, status = 'scheduled', attempts = 0,
      error_message = null, updated_at = now() where id = job.id returning * into result;
  elsif action_value = 'cancel' then
    if job.status = 'cancelled' then raise exception 'job is already cancelled'; end if;
    update public.publish_jobs set status = 'cancelled', updated_at = now() where id = job.id returning * into result;
  elsif action_value = 'retry' then
    if job.status <> 'failed' then raise exception 'only failed jobs can be retried'; end if;
    update public.publish_jobs set scheduled_for = coalesce(p_scheduled_for, now() + interval '2 minutes'),
      status = 'scheduled', attempts = 0, error_message = null, updated_at = now()
    where id = job.id returning * into result;
  else
    raise exception 'invalid job action';
  end if;

  if exists(select 1 from public.publish_jobs j where j.content_item_id = item.id and j.status in ('scheduled','retrying','publishing')) then
    update public.content_items set status = 'scheduled', updated_at = now() where id = item.id;
  elsif exists(select 1 from public.publish_jobs j where j.content_item_id = item.id and j.status = 'failed') then
    update public.content_items set status = 'failed', updated_at = now() where id = item.id;
  else
    update public.content_items set status = 'ready', updated_at = now() where id = item.id;
  end if;

  perform private.write_activity(item.brand_id, 'publish_job.' || action_value, 'publish_job', job.id::text,
    jsonb_build_object('scheduled_for', result.scheduled_for, 'platform', job.platform, 'kind', job.publish_kind));
  return result;
end;
$$;

create or replace function public.claim_due_publish_jobs(p_batch_size int default 6)
returns setof public.publish_jobs
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with picked as (
    select j.id
    from public.publish_jobs j
    join public.content_items c on c.id = j.content_item_id
    join public.brand_rules r on r.brand_id = c.brand_id
    where j.status in ('scheduled','retrying')
      and j.scheduled_for <= now()
      and j.attempts < 4
      and (not r.approval_required or c.approval_status = 'approved')
    order by j.scheduled_for
    for update of j skip locked
    limit greatest(1, least(coalesce(p_batch_size, 6), 12))
  ), upd as (
    update public.publish_jobs j
    set status = 'publishing', attempts = j.attempts + 1, last_attempt_at = now(), updated_at = now()
    from picked p where j.id = p.id returning j.*
  )
  select * from upd;
end;
$$;

create or replace function private.log_content_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_activity(new.brand_id, 'content.created', 'content_item', new.id::text,
    jsonb_build_object('title', new.title, 'approval_status', new.approval_status), new.created_by);
  return new;
end;
$$;

drop trigger if exists content_created_activity on public.content_items;
create trigger content_created_activity after insert on public.content_items
for each row execute function private.log_content_created();

create or replace function private.log_worker_job_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_brand uuid;
begin
  if (select auth.uid()) is not null or new.status is not distinct from old.status then return new; end if;
  if new.status not in ('publishing','retrying','posted','failed') then return new; end if;
  select c.brand_id into target_brand from public.content_items c where c.id = new.content_item_id;
  perform private.write_activity(target_brand, 'publish_job.status_changed', 'publish_job', new.id::text,
    jsonb_build_object('from', old.status, 'to', new.status, 'platform', new.platform, 'kind', new.publish_kind, 'error', new.error_message), null);
  return new;
end;
$$;

drop trigger if exists publish_job_status_activity on public.publish_jobs;
create trigger publish_job_status_activity after update of status on public.publish_jobs
for each row execute function private.log_worker_job_status();

create or replace function public.create_workspace_invite(
  p_organization_id uuid,
  p_email text,
  p_role public.member_role,
  p_brand_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller_role public.member_role;
  clean_email text := lower(trim(coalesce(p_email, '')));
  invite_token text := gen_random_uuid()::text || gen_random_uuid()::text;
  invitation public.workspace_invitations;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select m.role into caller_role from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = (select auth.uid());
  if caller_role not in ('owner','admin') then raise exception 'forbidden'; end if;
  if p_role = 'owner' or (caller_role = 'admin' and p_role = 'admin') then raise exception 'role cannot be assigned'; end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'valid email is required'; end if;
  if exists(select 1 from auth.users u join public.memberships m on m.user_id = u.id where m.organization_id = p_organization_id and lower(u.email) = clean_email) then
    raise exception 'user is already a workspace member';
  end if;
  if exists(select 1 from unnest(coalesce(p_brand_ids, '{}'::uuid[])) brand_id where not exists(
    select 1 from public.brands b where b.id = brand_id and b.organization_id = p_organization_id
  )) then raise exception 'invalid brand selection'; end if;

  update public.workspace_invitations set revoked_at = now()
  where organization_id = p_organization_id and email = clean_email and accepted_at is null and revoked_at is null;
  insert into public.workspace_invitations(organization_id,email,role,brand_ids,token_hash,invited_by)
  values(p_organization_id, clean_email, p_role, coalesce(p_brand_ids, '{}'::uuid[]), extensions.digest(invite_token, 'sha256'), (select auth.uid()))
  returning * into invitation;

  insert into public.activity_logs(organization_id,user_id,action,entity_type,entity_id,details)
  values(p_organization_id,(select auth.uid()),'team.invited','workspace_invitation',invitation.id::text,jsonb_build_object('email',clean_email,'role',p_role,'brand_ids',p_brand_ids));
  return jsonb_build_object('id',invitation.id,'email',clean_email,'role',p_role,'brand_ids',invitation.brand_ids,'expires_at',invitation.expires_at,'token',invite_token);
end;
$$;

create or replace function public.accept_workspace_invite(p_token text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  invitation public.workspace_invitations;
  user_email text;
  invite_brand_id uuid;
  upload_allowed boolean;
  edit_allowed boolean;
  publish_allowed boolean;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  if length(coalesce(p_token, '')) < 60 then raise exception 'invalid invitation'; end if;
  select lower(u.email) into user_email from auth.users u where u.id = (select auth.uid());
  select * into invitation from public.workspace_invitations i
  where i.token_hash = extensions.digest(p_token, 'sha256') and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  for update;
  if invitation.id is null then raise exception 'invitation is invalid or expired'; end if;
  if user_email is null or user_email <> invitation.email then raise exception 'use the invited email address'; end if;

  insert into public.profiles(id,display_name) values((select auth.uid()),user_email) on conflict(id) do nothing;
  insert into public.memberships(organization_id,user_id,role)
  values(invitation.organization_id,(select auth.uid()),invitation.role) on conflict do nothing;

  upload_allowed := invitation.role in ('editor','uploader');
  edit_allowed := invitation.role = 'editor';
  publish_allowed := invitation.role = 'editor';
  if invitation.role <> 'admin' then
    foreach invite_brand_id in array invitation.brand_ids loop
      insert into public.brand_memberships(brand_id,user_id,can_upload,can_edit,can_publish)
      values(invite_brand_id,(select auth.uid()),upload_allowed,edit_allowed,publish_allowed)
      on conflict(brand_id,user_id) do update set can_upload=excluded.can_upload,can_edit=excluded.can_edit,can_publish=excluded.can_publish;
    end loop;
  end if;

  update public.workspace_invitations
  set accepted_at = now(), accepted_by = (select auth.uid()) where id = invitation.id;
  insert into public.activity_logs(organization_id,user_id,action,entity_type,entity_id,details)
  values(invitation.organization_id,(select auth.uid()),'team.joined','membership',(select auth.uid())::text,jsonb_build_object('role',invitation.role));
  return jsonb_build_object('organization_id',invitation.organization_id,'role',invitation.role);
end;
$$;

create or replace function public.list_workspace_team(p_organization_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller_role public.member_role;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select m.role into caller_role from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = (select auth.uid());
  if caller_role is null then raise exception 'forbidden'; end if;

  return jsonb_build_object(
    'current_role', caller_role,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id',m.user_id,'display_name',coalesce(nullif(p.display_name,''),u.email,'Anggota tim'),
        'email',u.email,'role',m.role,'created_at',m.created_at,
        'brand_access',coalesce((select jsonb_agg(jsonb_build_object(
          'brand_id',bm.brand_id,'can_upload',bm.can_upload,'can_edit',bm.can_edit,'can_publish',bm.can_publish
        ) order by b.name) from public.brand_memberships bm join public.brands b on b.id=bm.brand_id
          where bm.user_id=m.user_id and b.organization_id=p_organization_id),'[]'::jsonb)
      ) order by case when m.role='owner' then 0 when m.role='admin' then 1 else 2 end, m.created_at)
      from public.memberships m left join public.profiles p on p.id=m.user_id left join auth.users u on u.id=m.user_id
      where m.organization_id=p_organization_id
    ),'[]'::jsonb),
    'invitations',case when caller_role in ('owner','admin') then coalesce((
      select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'brand_ids',i.brand_ids,'expires_at',i.expires_at,'created_at',i.created_at) order by i.created_at desc)
      from public.workspace_invitations i where i.organization_id=p_organization_id and i.accepted_at is null and i.revoked_at is null and i.expires_at>now()
    ),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.list_workspace_activity(
  p_organization_id uuid,
  p_limit integer default 100
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_org_member(p_organization_id) then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',a.id,'brand_id',a.brand_id,'action',a.action,'entity_type',a.entity_type,
      'entity_id',a.entity_id,'details',a.details,'created_at',a.created_at,
      'actor_name',coalesce(nullif(p.display_name,''),u.email,'Sistem publikasi')
    ) order by a.created_at desc)
    from (
      select * from public.activity_logs
      where organization_id=p_organization_id
      order by created_at desc
      limit greatest(1,least(coalesce(p_limit,100),200))
    ) a
    left join public.profiles p on p.id=a.user_id
    left join auth.users u on u.id=a.user_id
  ),'[]'::jsonb);
end;
$$;

create or replace function public.update_workspace_member(
  p_organization_id uuid,
  p_user_id uuid,
  p_role public.member_role,
  p_remove boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller_role public.member_role;
  target_role public.member_role;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select role into caller_role from public.memberships where organization_id=p_organization_id and user_id=(select auth.uid());
  select role into target_role from public.memberships where organization_id=p_organization_id and user_id=p_user_id;
  if caller_role not in ('owner','admin') or target_role is null then raise exception 'forbidden'; end if;
  if target_role='owner' or p_role='owner' or (caller_role='admin' and target_role='admin') or (caller_role='admin' and p_role='admin') then
    raise exception 'role cannot be changed';
  end if;
  if p_remove then
    delete from public.brand_memberships bm using public.brands b
    where bm.brand_id=b.id and b.organization_id=p_organization_id and bm.user_id=p_user_id;
    delete from public.memberships where organization_id=p_organization_id and user_id=p_user_id;
  else
    update public.memberships set role=p_role where organization_id=p_organization_id and user_id=p_user_id;
  end if;
  insert into public.activity_logs(organization_id,user_id,action,entity_type,entity_id,details)
  values(p_organization_id,(select auth.uid()),case when p_remove then 'team.removed' else 'team.role_updated' end,'membership',p_user_id::text,jsonb_build_object('role',p_role));
end;
$$;

create or replace function public.update_brand_member_access(
  p_brand_id uuid,
  p_user_id uuid,
  p_enabled boolean,
  p_can_upload boolean default false,
  p_can_edit boolean default false,
  p_can_publish boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  org_id uuid;
  caller_role public.member_role;
  target_role public.member_role;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select b.organization_id into org_id from public.brands b where b.id=p_brand_id;
  select role into caller_role from public.memberships where organization_id=org_id and user_id=(select auth.uid());
  select role into target_role from public.memberships where organization_id=org_id and user_id=p_user_id;
  if caller_role not in ('owner','admin') or target_role is null then raise exception 'forbidden'; end if;
  if target_role in ('owner','admin') then raise exception 'admins already access all brands'; end if;
  if p_can_edit and not p_can_upload then raise exception 'edit access requires upload access'; end if;
  if p_can_publish and not p_can_edit then raise exception 'publish access requires edit access'; end if;

  if p_enabled then
    insert into public.brand_memberships(brand_id,user_id,can_upload,can_edit,can_publish)
    values(p_brand_id,p_user_id,p_can_upload,p_can_edit,p_can_publish)
    on conflict(brand_id,user_id) do update set can_upload=excluded.can_upload,can_edit=excluded.can_edit,can_publish=excluded.can_publish;
  else
    delete from public.brand_memberships where brand_id=p_brand_id and user_id=p_user_id;
  end if;
  perform private.write_activity(p_brand_id,'team.brand_access_updated','membership',p_user_id::text,
    jsonb_build_object('enabled',p_enabled,'can_upload',p_can_upload,'can_edit',p_can_edit,'can_publish',p_can_publish));
end;
$$;

create or replace function public.revoke_workspace_invite(p_invitation_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  invitation public.workspace_invitations;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select * into invitation from public.workspace_invitations where id=p_invitation_id;
  if invitation.id is null or not private.has_org_role(invitation.organization_id,array['owner','admin']) then raise exception 'forbidden'; end if;
  update public.workspace_invitations set revoked_at=now() where id=invitation.id and accepted_at is null;
  insert into public.activity_logs(organization_id,user_id,action,entity_type,entity_id,details)
  values(invitation.organization_id,(select auth.uid()),'team.invite_revoked','workspace_invitation',invitation.id::text,jsonb_build_object('email',invitation.email));
end;
$$;

-- Expand the brand settings RPC with approval control. Drop the older
-- four-argument signature so PostgREST has a single unambiguous endpoint.
drop function if exists public.update_brand_schedule_rules(uuid,boolean,integer,jsonb);
create or replace function public.update_brand_schedule_rules(
  p_brand_id uuid,
  p_autopilot_enabled boolean,
  p_min_gap_minutes integer,
  p_posting_windows jsonb,
  p_approval_required boolean default false
) returns public.brand_rules
language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  time_text text;
  day_value integer;
  seen_days integer[] := '{}';
  result public.brand_rules;
begin
  if (select auth.uid()) is null or not private.can_edit_brand(p_brand_id) then raise exception 'forbidden'; end if;
  if p_min_gap_minutes < 0 or p_min_gap_minutes > 1440 then raise exception 'minimum gap must be between 0 and 1440 minutes'; end if;
  if jsonb_typeof(p_posting_windows) <> 'array' or jsonb_array_length(p_posting_windows) < 1 or jsonb_array_length(p_posting_windows) > 7 then
    raise exception 'posting windows must contain one to seven days';
  end if;
  for item in select value from jsonb_array_elements(p_posting_windows) loop
    if coalesce(item->>'day','') !~ '^[0-6]$' or jsonb_typeof(item->'times') <> 'array' then raise exception 'invalid posting window'; end if;
    day_value := (item->>'day')::integer;
    if day_value = any(seen_days) then raise exception 'duplicate posting day'; end if;
    seen_days := array_append(seen_days,day_value);
    if jsonb_array_length(item->'times') < 1 or jsonb_array_length(item->'times') > 4 then raise exception 'each day needs one to four posting times'; end if;
    for time_text in select jsonb_array_elements_text(item->'times') loop
      if time_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'invalid posting time'; end if;
    end loop;
  end loop;
  update public.brand_rules set autopilot_enabled=coalesce(p_autopilot_enabled,true), approval_required=coalesce(p_approval_required,false),
    min_gap_minutes=p_min_gap_minutes,posting_windows=p_posting_windows,updated_at=now()
  where brand_id=p_brand_id returning * into result;
  if result.brand_id is null then raise exception 'brand schedule rules not found'; end if;
  perform private.write_activity(p_brand_id,'brand.rules_updated','brand',p_brand_id::text,
    jsonb_build_object('autopilot_enabled',result.autopilot_enabled,'approval_required',result.approval_required,'min_gap_minutes',result.min_gap_minutes));
  return result;
end;
$$;

revoke execute on function public.update_content_details(uuid,text,text,text) from public, anon;
revoke execute on function public.submit_content_for_review(uuid) from public, anon;
revoke execute on function public.review_content(uuid,text,text) from public, anon;
revoke execute on function public.manage_publish_job(uuid,text,timestamptz) from public, anon;
revoke execute on function public.create_workspace_invite(uuid,text,public.member_role,uuid[]) from public, anon;
revoke execute on function public.accept_workspace_invite(text) from public, anon;
revoke execute on function public.list_workspace_team(uuid) from public, anon;
revoke execute on function public.list_workspace_activity(uuid,integer) from public, anon;
revoke execute on function public.update_workspace_member(uuid,uuid,public.member_role,boolean) from public, anon;
revoke execute on function public.update_brand_member_access(uuid,uuid,boolean,boolean,boolean,boolean) from public, anon;
revoke execute on function public.revoke_workspace_invite(uuid) from public, anon;
revoke execute on function public.update_brand_schedule_rules(uuid,boolean,integer,jsonb,boolean) from public, anon;

grant execute on function public.update_content_details(uuid,text,text,text) to authenticated;
grant execute on function public.submit_content_for_review(uuid) to authenticated;
grant execute on function public.review_content(uuid,text,text) to authenticated;
grant execute on function public.manage_publish_job(uuid,text,timestamptz) to authenticated;
grant execute on function public.create_workspace_invite(uuid,text,public.member_role,uuid[]) to authenticated;
grant execute on function public.accept_workspace_invite(text) to authenticated;
grant execute on function public.list_workspace_team(uuid) to authenticated;
grant execute on function public.list_workspace_activity(uuid,integer) to authenticated;
grant execute on function public.update_workspace_member(uuid,uuid,public.member_role,boolean) to authenticated;
grant execute on function public.update_brand_member_access(uuid,uuid,boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.revoke_workspace_invite(uuid) to authenticated;
grant execute on function public.update_brand_schedule_rules(uuid,boolean,integer,jsonb,boolean) to authenticated;

revoke execute on function private.log_content_created() from public, anon, authenticated;
revoke execute on function private.log_worker_job_status() from public, anon, authenticated;
revoke execute on function public.schedule_content_hybrid(uuid,text[],text,timestamptz) from public, anon;
grant execute on function public.schedule_content_hybrid(uuid,text[],text,timestamptz) to authenticated;

-- The worker remains the only caller allowed to claim due jobs.
revoke execute on function public.claim_due_publish_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_due_publish_jobs(int) to service_role;
