-- Per-channel copy/scheduling and safe same-brand content duplication.

alter table public.publish_jobs
  add column if not exists caption text;

create or replace function private.validate_channel_settings(
  p_channels text[],
  p_settings jsonb
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  setting jsonb;
  channel_value text;
  seen text[] := '{}';
  scheduled_value timestamptz;
begin
  if jsonb_typeof(coalesce(p_settings, '[]'::jsonb)) <> 'array' then
    raise exception 'channel settings must be an array';
  end if;
  if jsonb_array_length(coalesce(p_settings, '[]'::jsonb)) > coalesce(array_length(p_channels, 1), 0) then
    raise exception 'too many channel settings';
  end if;

  for setting in select value from jsonb_array_elements(coalesce(p_settings, '[]'::jsonb)) loop
    channel_value := nullif(trim(coalesce(setting->>'channel', '')), '');
    if channel_value is null or not (channel_value = any(coalesce(p_channels, '{}'::text[]))) then
      raise exception 'channel setting is not selected';
    end if;
    if channel_value = any(seen) then raise exception 'duplicate channel setting'; end if;
    seen := array_append(seen, channel_value);
    if char_length(coalesce(setting->>'caption', '')) > 5000 then raise exception 'channel caption is too long'; end if;
    if nullif(setting->>'scheduled_for', '') is not null then
      scheduled_value := (setting->>'scheduled_for')::timestamptz;
      if scheduled_value <= now() then raise exception 'channel schedule must be in the future'; end if;
    end if;
  end loop;
end;
$$;

create or replace function private.apply_channel_settings(
  p_content_id uuid,
  p_settings jsonb,
  p_fallback_caption text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  setting jsonb;
  channel_value text;
  platform_value public.social_platform;
  kind_value public.publish_kind;
  scheduled_value timestamptz;
begin
  update public.publish_jobs
  set caption = nullif(trim(coalesce(p_fallback_caption, '')), ''), updated_at = now()
  where content_item_id = p_content_id and status not in ('publishing','posted');

  for setting in select value from jsonb_array_elements(coalesce(p_settings, '[]'::jsonb)) loop
    channel_value := setting->>'channel';
    case channel_value
      when 'ig_feed' then platform_value := 'instagram'; kind_value := 'feed';
      when 'ig_story' then platform_value := 'instagram'; kind_value := 'story';
      when 'ig_reel' then platform_value := 'instagram'; kind_value := 'reel';
      when 'fb_feed' then platform_value := 'facebook'; kind_value := 'feed';
      when 'fb_story' then platform_value := 'facebook'; kind_value := 'story';
      when 'fb_reel' then platform_value := 'facebook'; kind_value := 'reel';
      else continue;
    end case;
    scheduled_value := case when nullif(setting->>'scheduled_for', '') is null then null else (setting->>'scheduled_for')::timestamptz end;
    update public.publish_jobs
    set caption = coalesce(nullif(trim(coalesce(setting->>'caption', '')), ''), nullif(trim(coalesce(p_fallback_caption, '')), '')),
        scheduled_for = coalesce(scheduled_value, scheduled_for),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('channel_customized', true),
        updated_at = now()
    where content_item_id = p_content_id and platform = platform_value and publish_kind = kind_value
      and status not in ('publishing','posted');
  end loop;
end;
$$;

create or replace function public.create_content_with_channel_settings(
  p_brand_id uuid,
  p_title text,
  p_brief text,
  p_caption text,
  p_content_format text,
  p_assets jsonb,
  p_channels text[],
  p_schedule_mode text default 'smart',
  p_scheduled_for timestamptz default null,
  p_channel_settings jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  content_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  if not private.can_upload_brand(p_brand_id) then raise exception 'forbidden'; end if;
  perform private.validate_channel_settings(p_channels, p_channel_settings);

  result := public.create_content_with_assets(
    p_brand_id, p_title, p_brief, p_caption, p_content_format, p_assets,
    p_channels, p_schedule_mode, p_scheduled_for
  );
  content_id := (result->>'content_id')::uuid;

  update public.content_items
  set ai_metadata = coalesce(ai_metadata, '{}'::jsonb) || jsonb_build_object(
        'requested_channel_settings', coalesce(p_channel_settings, '[]'::jsonb)
      ), updated_at = now()
  where id = content_id;
  perform private.apply_channel_settings(content_id, p_channel_settings, p_caption);
  return result;
end;
$$;

create or replace function public.update_content_customization(
  p_content_id uuid,
  p_title text,
  p_brief text default null,
  p_caption text default null,
  p_channel_settings jsonb default '[]'::jsonb
) returns public.content_items
language plpgsql security definer set search_path = '' as $$
declare
  item public.content_items;
  result public.content_items;
  requested_channels text[];
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select * into item from public.content_items where id = p_content_id;
  if item.id is null then raise exception 'content not found'; end if;
  select coalesce(array_agg(value), '{}'::text[]) into requested_channels
  from jsonb_array_elements_text(coalesce(item.ai_metadata->'requested_channels', '[]'::jsonb));
  perform private.validate_channel_settings(requested_channels, p_channel_settings);

  result := public.update_content_details(p_content_id, p_title, p_brief, p_caption);
  update public.content_items
  set ai_metadata = coalesce(ai_metadata, '{}'::jsonb) || jsonb_build_object(
        'requested_channel_settings', coalesce(p_channel_settings, '[]'::jsonb)
      ), updated_at = now()
  where id = p_content_id returning * into result;
  perform private.apply_channel_settings(p_content_id, p_channel_settings, p_caption);
  perform private.write_activity(item.brand_id, 'content.channels_updated', 'content_item', item.id::text,
    jsonb_build_object('channels', requested_channels));
  return result;
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
  channel_settings jsonb;
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
    channel_settings := coalesce(item.ai_metadata->'requested_channel_settings', '[]'::jsonb);
    if nullif(item.ai_metadata->>'requested_scheduled_for', '') is not null then
      requested_time := (item.ai_metadata->>'requested_scheduled_for')::timestamptz;
    end if;

    if coalesce(array_length(requested_channels, 1), 0) > 0 then
      begin
        perform public.schedule_content_hybrid(item.id, requested_channels, requested_mode, requested_time);
        perform private.apply_channel_settings(item.id, channel_settings, item.caption);
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

create or replace function public.duplicate_content_item(p_content_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  source public.content_items;
  duplicate_id uuid;
  duplicate_metadata jsonb;
  clean_settings jsonb;
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  select * into source from public.content_items where id = p_content_id;
  if source.id is null then raise exception 'content not found'; end if;
  if not private.can_upload_brand(source.brand_id) then raise exception 'forbidden'; end if;

  select coalesce(jsonb_agg((setting - 'scheduled_for') || jsonb_build_object('scheduled_for', null)), '[]'::jsonb)
  into clean_settings
  from jsonb_array_elements(coalesce(source.ai_metadata->'requested_channel_settings', '[]'::jsonb)) setting;
  duplicate_metadata := (coalesce(source.ai_metadata, '{}'::jsonb) - 'schedule_mode' - 'scheduled_for' - 'schedule_reason')
    || jsonb_build_object(
      'requested_schedule_mode', 'smart',
      'requested_scheduled_for', null,
      'requested_channel_settings', clean_settings,
      'duplicated_from', source.id
    );

  insert into public.content_items(
    brand_id, created_by, title, brief, caption, media_type, primary_asset_path,
    status, approval_status, review_note, reviewed_by, reviewed_at, auto_schedule, ai_metadata
  ) values (
    source.brand_id, (select auth.uid()), left(source.title || ' (Salinan)', 160), source.brief,
    source.caption, source.media_type, source.primary_asset_path, 'ready', 'draft', null, null, null, true, duplicate_metadata
  ) returning id into duplicate_id;

  insert into public.content_assets(
    content_item_id, storage_path, media_type, mime_type, width, height,
    duration_seconds, bytes, variant, position
  )
  select duplicate_id, storage_path, media_type, mime_type, width, height,
    duration_seconds, bytes, variant, position
  from public.content_assets where content_item_id = source.id order by position, created_at;

  if not found then
    insert into public.content_assets(content_item_id, storage_path, media_type, variant, position)
    values(duplicate_id, source.primary_asset_path, source.media_type, 'primary', 0);
  end if;

  perform private.write_activity(source.brand_id, 'content.duplicated', 'content_item', duplicate_id::text,
    jsonb_build_object('source_content_id', source.id));
  return jsonb_build_object('content_id', duplicate_id, 'source_content_id', source.id);
end;
$$;

revoke execute on function private.validate_channel_settings(text[],jsonb) from public,anon,authenticated;
revoke execute on function private.apply_channel_settings(uuid,jsonb,text) from public,anon,authenticated;
revoke execute on function public.create_content_with_channel_settings(uuid,text,text,text,text,jsonb,text[],text,timestamptz,jsonb) from public,anon;
revoke execute on function public.update_content_customization(uuid,text,text,text,jsonb) from public,anon;
revoke execute on function public.duplicate_content_item(uuid) from public,anon;
grant execute on function public.create_content_with_channel_settings(uuid,text,text,text,text,jsonb,text[],text,timestamptz,jsonb) to authenticated;
grant execute on function public.update_content_customization(uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.duplicate_content_item(uuid) to authenticated;

