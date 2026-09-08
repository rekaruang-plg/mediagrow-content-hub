-- Brand voice settings used by the internal content team.
-- Existing scheduling fields stay untouched and all updates still pass through
-- the brand-level edit authorization already used by the workspace.

alter table public.brand_rules
  add column if not exists prohibited_terms text,
  add column if not exists content_pillars jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'brand_rules_content_pillars_array'
      and conrelid = 'public.brand_rules'::regclass
  ) then
    alter table public.brand_rules
      add constraint brand_rules_content_pillars_array
      check (jsonb_typeof(content_pillars) = 'array' and jsonb_array_length(content_pillars) <= 12);
  end if;
end $$;

create or replace function public.update_brand_kit(
  p_brand_id uuid,
  p_tone text default null,
  p_default_cta text default null,
  p_target_audience text default null,
  p_hashtag_guidance text default null,
  p_prohibited_terms text default null,
  p_content_pillars jsonb default '[]'::jsonb
) returns public.brand_rules
language plpgsql security invoker set search_path = '' as $$
declare
  pillar jsonb;
  result public.brand_rules;
begin
  if (select auth.uid()) is null or not private.can_edit_brand(p_brand_id) then
    raise exception 'forbidden';
  end if;
  if jsonb_typeof(coalesce(p_content_pillars, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_content_pillars, '[]'::jsonb)) > 12 then
    raise exception 'content pillars must be an array with at most 12 items';
  end if;
  for pillar in select value from jsonb_array_elements(coalesce(p_content_pillars, '[]'::jsonb)) loop
    if jsonb_typeof(pillar) <> 'string' or length(trim(pillar #>> '{}')) < 1 or length(trim(pillar #>> '{}')) > 80 then
      raise exception 'each content pillar must contain 1 to 80 characters';
    end if;
  end loop;
  if length(coalesce(p_tone, '')) > 1000
     or length(coalesce(p_default_cta, '')) > 1000
     or length(coalesce(p_target_audience, '')) > 1000
     or length(coalesce(p_hashtag_guidance, '')) > 1500
     or length(coalesce(p_prohibited_terms, '')) > 1500 then
    raise exception 'brand kit field is too long';
  end if;

  update public.brand_rules
  set tone = nullif(trim(coalesce(p_tone, '')), ''),
      default_cta = nullif(trim(coalesce(p_default_cta, '')), ''),
      target_audience = nullif(trim(coalesce(p_target_audience, '')), ''),
      hashtag_guidance = nullif(trim(coalesce(p_hashtag_guidance, '')), ''),
      prohibited_terms = nullif(trim(coalesce(p_prohibited_terms, '')), ''),
      content_pillars = coalesce(p_content_pillars, '[]'::jsonb),
      updated_at = now()
  where brand_id = p_brand_id
  returning * into result;

  if result.brand_id is null then raise exception 'brand kit not found'; end if;
  return result;
end;
$$;

create or replace function private.log_brand_kit_update()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if row(new.tone, new.default_cta, new.target_audience, new.hashtag_guidance, new.prohibited_terms, new.content_pillars)
     is not distinct from
     row(old.tone, old.default_cta, old.target_audience, old.hashtag_guidance, old.prohibited_terms, old.content_pillars) then
    return new;
  end if;
  perform private.write_activity(
    new.brand_id,
    'brand.kit_updated',
    'brand',
    new.brand_id::text,
    jsonb_build_object('content_pillar_count', jsonb_array_length(new.content_pillars))
  );
  return new;
end;
$$;

drop trigger if exists brand_kit_update_activity on public.brand_rules;
create trigger brand_kit_update_activity
after update of tone, default_cta, target_audience, hashtag_guidance, prohibited_terms, content_pillars
on public.brand_rules
for each row execute function private.log_brand_kit_update();

revoke execute on function public.update_brand_kit(uuid,text,text,text,text,text,jsonb) from public, anon;
grant execute on function public.update_brand_kit(uuid,text,text,text,text,text,jsonb) to authenticated;
revoke execute on function private.log_brand_kit_update() from public, anon, authenticated;
