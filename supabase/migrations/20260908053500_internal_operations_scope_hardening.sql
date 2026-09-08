-- Keep workspace-wide people and activity data limited to administrators.
-- Other members only receive their own profile and activity for assigned brands.

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
        and (caller_role in ('owner','admin') or m.user_id=(select auth.uid()))
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
declare
  caller_role public.member_role;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select m.role into caller_role from public.memberships m
  where m.organization_id=p_organization_id and m.user_id=(select auth.uid());
  if caller_role is null then raise exception 'forbidden'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',a.id,'brand_id',a.brand_id,'action',a.action,'entity_type',a.entity_type,
      'entity_id',a.entity_id,'details',a.details,'created_at',a.created_at,
      'actor_name',coalesce(nullif(p.display_name,''),u.email,'Sistem publikasi')
    ) order by a.created_at desc)
    from (
      select * from public.activity_logs log
      where log.organization_id=p_organization_id
        and (caller_role in ('owner','admin') or (log.brand_id is not null and private.can_access_brand(log.brand_id)))
      order by log.created_at desc
      limit greatest(1,least(coalesce(p_limit,100),200))
    ) a
    left join public.profiles p on p.id=a.user_id
    left join auth.users u on u.id=a.user_id
  ),'[]'::jsonb);
end;
$$;

revoke execute on function public.list_workspace_team(uuid) from public, anon;
revoke execute on function public.list_workspace_activity(uuid,integer) from public, anon;
grant execute on function public.list_workspace_team(uuid) to authenticated;
grant execute on function public.list_workspace_activity(uuid,integer) to authenticated;
