-- Multi-asset content for Instagram/Facebook carousel feeds and stories.

alter table public.content_assets
  add column if not exists position smallint not null default 0;

create index if not exists idx_content_assets_content_position
  on public.content_assets(content_item_id, position, created_at);

create or replace function public.create_content_with_assets(
  p_brand_id uuid,
  p_title text,
  p_brief text,
  p_caption text,
  p_content_format text,
  p_assets jsonb,
  p_channels text[],
  p_schedule_mode text default 'smart',
  p_scheduled_for timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  clean_format text := lower(trim(coalesce(p_content_format, '')));
  clean_mode text := lower(trim(coalesce(p_schedule_mode, 'smart')));
  asset_count integer := jsonb_array_length(coalesce(p_assets, '[]'::jsonb));
  first_asset jsonb;
  rules public.brand_rules;
  content_id uuid;
  needs_review boolean;
  scheduled_count integer := 0;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  if not private.can_upload_brand(p_brand_id) then raise exception 'forbidden'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'title is required'; end if;
  if clean_format not in ('feed', 'carousel', 'story', 'reel') then raise exception 'invalid content format'; end if;
  if clean_mode not in ('manual', 'auto', 'smart') then raise exception 'invalid schedule mode'; end if;
  if coalesce(array_length(p_channels, 1), 0) = 0 then raise exception 'select at least one channel'; end if;
  if clean_mode = 'manual' and (p_scheduled_for is null or p_scheduled_for <= now()) then
    raise exception 'manual schedule must be in the future';
  end if;

  if (clean_format in ('feed', 'reel') and asset_count <> 1)
     or (clean_format = 'carousel' and asset_count not between 2 and 10)
     or (clean_format = 'story' and asset_count not between 1 and 10) then
    raise exception 'invalid asset count for content format';
  end if;

  if exists (
    select 1 from unnest(p_channels) channel
    where (clean_format in ('feed', 'carousel') and channel not in ('ig_feed', 'fb_feed'))
       or (clean_format = 'story' and channel not in ('ig_story', 'fb_story'))
       or (clean_format = 'reel' and channel not in ('ig_reel', 'fb_reel'))
  ) then raise exception 'channel is incompatible with content format'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_assets) asset
    where asset->>'storage_path' not like p_brand_id::text || '/%'
       or asset->>'media_type' not in ('image', 'video')
       or nullif(asset->>'mime_type', '') is null
       or coalesce((asset->>'bytes')::bigint, 0) <= 0
  ) then raise exception 'invalid asset metadata'; end if;

  if clean_format = 'carousel' and exists (
    select 1 from jsonb_array_elements(p_assets) asset where asset->>'media_type' <> 'image'
  ) then raise exception 'carousel currently supports images only'; end if;
  if clean_format = 'reel' and (p_assets->0->>'media_type') <> 'video' then
    raise exception 'reel requires one video';
  end if;
  if exists (select 1 from unnest(p_channels) channel where channel like 'ig\_%' escape '\')
     and exists (
       select 1 from jsonb_array_elements(p_assets) asset
       where asset->>'media_type' = 'image' and asset->>'mime_type' <> 'image/jpeg'
     ) then raise exception 'Instagram images must use JPG/JPEG'; end if;

  select * into rules from public.brand_rules where brand_id = p_brand_id;
  if rules.brand_id is null then raise exception 'brand rules not found'; end if;
  needs_review := rules.approval_required or not private.can_publish_brand(p_brand_id);
  first_asset := p_assets->0;

  insert into public.content_items(
    brand_id, created_by, title, brief, caption, media_type, primary_asset_path,
    status, approval_status, auto_schedule, ai_metadata
  ) values (
    p_brand_id, (select auth.uid()), trim(p_title), nullif(trim(coalesce(p_brief, '')), ''),
    nullif(p_caption, ''), (first_asset->>'media_type')::public.media_kind,
    first_asset->>'storage_path', 'ready',
    case when needs_review then 'pending_review' else 'approved' end,
    clean_mode <> 'manual', jsonb_build_object(
      'content_format', clean_format,
      'requested_channels', to_jsonb(p_channels),
      'requested_schedule_mode', clean_mode,
      'requested_scheduled_for', p_scheduled_for,
      'asset_count', asset_count
    )
  ) returning id into content_id;

  insert into public.content_assets(
    content_item_id, storage_path, media_type, mime_type, width, height,
    duration_seconds, bytes, variant, position
  )
  select content_id, asset->>'storage_path', (asset->>'media_type')::public.media_kind,
    asset->>'mime_type', nullif(asset->>'width', '')::integer,
    nullif(asset->>'height', '')::integer, nullif(asset->>'duration_seconds', '')::numeric,
    (asset->>'bytes')::bigint,
    case when ordinality = 1 then 'primary' when clean_format = 'carousel' then 'carousel_item' else 'story_frame' end,
    (ordinality - 1)::smallint
  from jsonb_array_elements(p_assets) with ordinality as a(asset, ordinality);

  if not needs_review then
    select count(*) into scheduled_count
    from public.schedule_content_hybrid(content_id, p_channels, clean_mode, p_scheduled_for);
  end if;

  return jsonb_build_object(
    'content_id', content_id,
    'needs_review', needs_review,
    'scheduled_count', scheduled_count
  );
end;
$$;

revoke execute on function public.create_content_with_assets(uuid,text,text,text,text,jsonb,text[],text,timestamptz) from public, anon;
grant execute on function public.create_content_with_assets(uuid,text,text,text,text,jsonb,text[],text,timestamptz) to authenticated;

-- Uploaders can remove their own orphaned upload when the database transaction fails.
drop policy if exists "content hub media delete" on storage.objects;
create policy "content hub media delete" on storage.objects for delete to authenticated using(
  bucket_id = 'content-media'
  and exists(
    select 1 from public.brands b
    where b.id::text = (storage.foldername(storage.objects.name))[1]
      and (private.can_edit_brand(b.id) or storage.objects.owner_id = (select auth.uid())::text)
  )
);
