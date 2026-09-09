-- Internal content planning workflow for multi-brand teams.
-- Publishing data and existing Meta connections are intentionally untouched.

create table public.content_plans (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  assignee_id uuid references auth.users(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  brief text check (brief is null or char_length(brief) <= 5000),
  objective text not null check (objective in ('awareness','trust','sales')),
  content_pillar text check (content_pillar is null or char_length(content_pillar) <= 80),
  content_format text not null check (content_format in ('feed','carousel','story','reel')),
  status text not null default 'idea' check (status in ('idea','copywriting','design','review','blocked','approved','scheduled','published','archived')),
  due_at timestamptz,
  planned_for timestamptz,
  content_item_id uuid unique references public.content_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_plan_comments (
  id bigint generated always as identity primary key,
  plan_id uuid not null references public.content_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index idx_content_plans_brand_status_due on public.content_plans(brand_id,status,due_at);
create index idx_content_plans_assignee_due on public.content_plans(assignee_id,due_at) where assignee_id is not null and status not in ('published','archived');
create index idx_content_plans_planned_for on public.content_plans(brand_id,planned_for) where planned_for is not null and status not in ('published','archived');
create index idx_content_plan_comments_plan_created on public.content_plan_comments(plan_id,created_at);

alter table public.content_plans enable row level security;
alter table public.content_plan_comments enable row level security;
create policy "content plans select" on public.content_plans for select to authenticated using (private.can_access_brand(brand_id));
create policy "content plan comments select" on public.content_plan_comments for select to authenticated using (
  exists(select 1 from public.content_plans plan where plan.id=content_plan_comments.plan_id and private.can_access_brand(plan.brand_id))
);

revoke all on public.content_plans from public,anon,authenticated;
revoke all on public.content_plan_comments from public,anon,authenticated;
revoke all on sequence public.content_plan_comments_id_seq from public,anon,authenticated;
grant select on public.content_plans to authenticated;
grant select on public.content_plan_comments to authenticated;
grant all on public.content_plans to service_role;
grant all on public.content_plan_comments to service_role;
grant all on sequence public.content_plan_comments_id_seq to service_role;

drop trigger if exists content_plans_updated_at on public.content_plans;
create trigger content_plans_updated_at before update on public.content_plans for each row execute function public.set_updated_at();

create or replace function private.plan_assignee_can_access(p_brand_id uuid,p_assignee_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_assignee_id is null or exists(
    select 1 from public.brands b
    join public.memberships m on m.organization_id=b.organization_id and m.user_id=p_assignee_id
    left join public.brand_memberships bm on bm.brand_id=b.id and bm.user_id=p_assignee_id
    where b.id=p_brand_id and (m.role in ('owner','admin') or bm.user_id is not null)
  )
$$;
revoke execute on function private.plan_assignee_can_access(uuid,uuid) from public,anon,authenticated;

create or replace function public.create_content_plan(
  p_brand_id uuid,p_title text,p_brief text,p_objective text,p_content_pillar text,p_content_format text,
  p_assignee_id uuid default null,p_due_at timestamptz default null,p_planned_for timestamptz default null
) returns public.content_plans
language plpgsql security definer set search_path='' as $$
declare
  result public.content_plans;
  clean_title text:=trim(coalesce(p_title,''));
  clean_objective text:=lower(trim(coalesce(p_objective,'')));
  clean_format text:=lower(trim(coalesce(p_content_format,'')));
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  if not private.can_upload_brand(p_brand_id) then raise exception 'forbidden'; end if;
  if clean_title='' or char_length(clean_title)>160 then raise exception 'invalid title'; end if;
  if clean_objective not in ('awareness','trust','sales') then raise exception 'invalid objective'; end if;
  if clean_format not in ('feed','carousel','story','reel') then raise exception 'invalid content format'; end if;
  if char_length(coalesce(p_brief,''))>5000 then raise exception 'brief is too long'; end if;
  if char_length(coalesce(p_content_pillar,''))>80 then raise exception 'content pillar is too long'; end if;
  if p_assignee_id is distinct from (select auth.uid()) and not private.can_edit_brand(p_brand_id) then raise exception 'only editors can assign another team member'; end if;
  if not private.plan_assignee_can_access(p_brand_id,p_assignee_id) then raise exception 'assignee cannot access this brand'; end if;

  insert into public.content_plans(brand_id,created_by,assignee_id,title,brief,objective,content_pillar,content_format,due_at,planned_for)
  values(p_brand_id,(select auth.uid()),p_assignee_id,clean_title,nullif(trim(coalesce(p_brief,'')),''),clean_objective,
    nullif(trim(coalesce(p_content_pillar,'')),''),clean_format,p_due_at,p_planned_for)
  returning * into result;
  perform private.write_activity(p_brand_id,'content_plan.created','content_plan',result.id::text,
    jsonb_build_object('title',result.title,'objective',result.objective,'assignee_id',result.assignee_id,'due_at',result.due_at));
  return result;
end;
$$;

create or replace function public.update_content_plan(
  p_plan_id uuid,p_title text,p_brief text,p_objective text,p_content_pillar text,p_content_format text,p_status text,
  p_assignee_id uuid default null,p_due_at timestamptz default null,p_planned_for timestamptz default null
) returns public.content_plans
language plpgsql security definer set search_path='' as $$
declare
  current_plan public.content_plans;
  result public.content_plans;
  clean_title text:=trim(coalesce(p_title,''));
  clean_objective text:=lower(trim(coalesce(p_objective,'')));
  clean_format text:=lower(trim(coalesce(p_content_format,'')));
  clean_status text:=lower(trim(coalesce(p_status,'')));
  full_editor boolean;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select * into current_plan from public.content_plans where id=p_plan_id;
  if current_plan.id is null or not private.can_access_brand(current_plan.brand_id) then raise exception 'forbidden'; end if;
  full_editor:=private.can_edit_brand(current_plan.brand_id);
  if not full_editor and current_plan.created_by is distinct from (select auth.uid()) and current_plan.assignee_id is distinct from (select auth.uid()) then raise exception 'forbidden'; end if;
  if not full_editor and p_assignee_id is distinct from current_plan.assignee_id then raise exception 'only editors can change PIC'; end if;
  if clean_title='' or char_length(clean_title)>160 then raise exception 'invalid title'; end if;
  if clean_objective not in ('awareness','trust','sales') then raise exception 'invalid objective'; end if;
  if clean_format not in ('feed','carousel','story','reel') then raise exception 'invalid content format'; end if;
  if clean_status not in ('idea','copywriting','design','review','blocked','approved','scheduled','published','archived') then raise exception 'invalid plan status'; end if;
  if char_length(coalesce(p_brief,''))>5000 then raise exception 'brief is too long'; end if;
  if char_length(coalesce(p_content_pillar,''))>80 then raise exception 'content pillar is too long'; end if;
  if not private.plan_assignee_can_access(current_plan.brand_id,p_assignee_id) then raise exception 'assignee cannot access this brand'; end if;

  update public.content_plans set title=clean_title,brief=nullif(trim(coalesce(p_brief,'')),''),objective=clean_objective,
    content_pillar=nullif(trim(coalesce(p_content_pillar,'')),''),content_format=clean_format,status=clean_status,
    assignee_id=p_assignee_id,due_at=p_due_at,planned_for=p_planned_for
  where id=current_plan.id returning * into result;
  perform private.write_activity(result.brand_id,'content_plan.updated','content_plan',result.id::text,
    jsonb_build_object('title',result.title,'status',result.status,'assignee_id',result.assignee_id,'due_at',result.due_at));
  return result;
end;
$$;

create or replace function public.add_content_plan_comment(p_plan_id uuid,p_body text)
returns public.content_plan_comments
language plpgsql security definer set search_path='' as $$
declare plan public.content_plans; result public.content_plan_comments; clean_body text:=trim(coalesce(p_body,''));
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select * into plan from public.content_plans where id=p_plan_id;
  if plan.id is null or not private.can_access_brand(plan.brand_id) then raise exception 'forbidden'; end if;
  if clean_body='' or char_length(clean_body)>2000 then raise exception 'invalid comment'; end if;
  insert into public.content_plan_comments(plan_id,user_id,body) values(plan.id,(select auth.uid()),clean_body) returning * into result;
  perform private.write_activity(plan.brand_id,'content_plan.commented','content_plan',plan.id::text,jsonb_build_object('comment_id',result.id));
  return result;
end;
$$;

create or replace function public.link_content_plan(p_plan_id uuid,p_content_item_id uuid)
returns public.content_plans
language plpgsql security definer set search_path='' as $$
declare plan public.content_plans; item public.content_items; result public.content_plans; next_status text;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select * into plan from public.content_plans where id=p_plan_id;
  select * into item from public.content_items where id=p_content_item_id;
  if plan.id is null or item.id is null or plan.brand_id<>item.brand_id then raise exception 'invalid plan link'; end if;
  if not private.can_upload_brand(plan.brand_id) then raise exception 'forbidden'; end if;
  if item.created_by is distinct from (select auth.uid()) and not private.can_edit_brand(plan.brand_id) then raise exception 'forbidden'; end if;
  if plan.content_item_id is not null and plan.content_item_id<>item.id then raise exception 'plan is already linked'; end if;
  next_status:=case when item.status='posted' then 'published' when item.status in ('scheduled','publishing','failed') then case when item.status='failed' then 'blocked' else 'scheduled' end when item.approval_status='approved' then 'approved' when item.approval_status='changes_requested' then 'blocked' else 'review' end;
  update public.content_plans set content_item_id=item.id,status=next_status where id=plan.id returning * into result;
  perform private.write_activity(plan.brand_id,'content_plan.linked','content_plan',plan.id::text,jsonb_build_object('content_item_id',item.id,'status',result.status));
  return result;
end;
$$;

create or replace function private.sync_linked_content_plan()
returns trigger language plpgsql security definer set search_path='' as $$
declare next_status text;
begin
  next_status:=case when new.status='posted' then 'published' when new.status in ('scheduled','publishing') then 'scheduled' when new.status='failed' then 'blocked' when new.approval_status='approved' then 'approved' when new.approval_status='changes_requested' then 'blocked' else 'review' end;
  update public.content_plans set status=next_status where content_item_id=new.id and status<>'archived';
  return new;
end;
$$;
drop trigger if exists sync_linked_content_plan on public.content_items;
create trigger sync_linked_content_plan after update of status,approval_status on public.content_items for each row execute function private.sync_linked_content_plan();

revoke execute on function private.sync_linked_content_plan() from public,anon,authenticated;
revoke execute on function public.create_content_plan(uuid,text,text,text,text,text,uuid,timestamptz,timestamptz) from public,anon;
revoke execute on function public.update_content_plan(uuid,text,text,text,text,text,text,uuid,timestamptz,timestamptz) from public,anon;
revoke execute on function public.add_content_plan_comment(uuid,text) from public,anon;
revoke execute on function public.link_content_plan(uuid,uuid) from public,anon;
grant execute on function public.create_content_plan(uuid,text,text,text,text,text,uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.update_content_plan(uuid,text,text,text,text,text,text,uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.add_content_plan_comment(uuid,text) to authenticated;
grant execute on function public.link_content_plan(uuid,uuid) to authenticated;
