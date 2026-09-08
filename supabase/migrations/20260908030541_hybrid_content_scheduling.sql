-- Hybrid scheduling: manual dates, rule-based autopilot, and a transparent
-- smart recommendation that learns from successful posting history.

create or replace function private.pick_schedule_slot(
  p_brand_id uuid,
  p_mode text default 'auto'
) returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rules public.brand_rules%rowtype;
  day_offset integer;
  slot jsonb;
  time_text text;
  local_date date;
  candidate timestamptz;
  candidate_hour integer;
  historical_success integer;
  score numeric;
  best_score numeric := -1000000;
  best_candidate timestamptz;
  min_gap integer;
begin
  if (select auth.uid()) is null or not private.can_access_brand(p_brand_id) then
    raise exception 'forbidden';
  end if;
  if p_mode not in ('auto', 'smart') then
    raise exception 'invalid schedule mode';
  end if;

  select * into rules from public.brand_rules where brand_id = p_brand_id;
  if rules.brand_id is null then
    raise exception 'brand schedule rules not found';
  end if;

  min_gap := coalesce(rules.min_gap_minutes, 180);

  for day_offset in 0..30 loop
    local_date := (now() at time zone coalesce(rules.timezone, 'Asia/Jakarta'))::date + day_offset;

    for slot in
      select value from jsonb_array_elements(coalesce(rules.posting_windows, '[]'::jsonb))
    loop
      if coalesce(slot->>'day', '') !~ '^[0-6]$'
         or (slot->>'day')::integer <> extract(dow from local_date)::integer
         or jsonb_typeof(slot->'times') <> 'array' then
        continue;
      end if;

      for time_text in select jsonb_array_elements_text(slot->'times') loop
        if time_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
          continue;
        end if;

        candidate := ((local_date::text || ' ' || time_text)::timestamp at time zone coalesce(rules.timezone, 'Asia/Jakarta'));
        if candidate <= now() then
          continue;
        end if;

        if exists (
          select 1
          from public.publish_jobs j
          join public.content_items c on c.id = j.content_item_id
          where c.brand_id = p_brand_id
            and j.status in ('scheduled', 'retrying', 'publishing')
            and abs(extract(epoch from (j.scheduled_for - candidate))) < min_gap * 60
        ) then
          continue;
        end if;

        if p_mode = 'auto' then
          return candidate;
        end if;

        candidate_hour := extract(hour from (candidate at time zone coalesce(rules.timezone, 'Asia/Jakarta')))::integer;
        select count(*)::integer into historical_success
        from public.publish_jobs j
        join public.content_items c on c.id = j.content_item_id
        where c.brand_id = p_brand_id
          and j.status = 'posted'
          and j.published_at is not null
          and extract(dow from (j.published_at at time zone coalesce(rules.timezone, 'Asia/Jakarta'))) = extract(dow from local_date)
          and extract(hour from (j.published_at at time zone coalesce(rules.timezone, 'Asia/Jakarta')))::integer = candidate_hour;

        score := historical_success * 4 - day_offset * 2;
        score := score + case
          when candidate_hour between 18 and 20 then 4
          when candidate_hour between 11 and 13 then 3
          when candidate_hour between 8 and 10 then 2
          else 0
        end;

        if best_candidate is null or score > best_score or (score = best_score and candidate < best_candidate) then
          best_candidate := candidate;
          best_score := score;
        end if;
      end loop;
    end loop;

    -- Smart mode considers one full week of configured slots. This keeps the
    -- recommendation useful without pushing content too far into the future.
    exit when p_mode = 'smart' and day_offset >= 7 and best_candidate is not null;
  end loop;

  if best_candidate is null then
    raise exception 'no posting slot available';
  end if;
  return best_candidate;
end;
$$;

revoke execute on function private.pick_schedule_slot(uuid, text) from public, anon;
grant execute on function private.pick_schedule_slot(uuid, text) to authenticated;

create or replace function public.recommend_content_schedule(
  p_brand_id uuid,
  p_mode text default 'smart'
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  mode_value text := lower(coalesce(p_mode, 'smart'));
  candidate timestamptz;
begin
  if (select auth.uid()) is null or not private.can_access_brand(p_brand_id) then
    raise exception 'forbidden';
  end if;
  if mode_value not in ('auto', 'smart') then
    raise exception 'invalid schedule mode';
  end if;

  candidate := private.pick_schedule_slot(p_brand_id, mode_value);
  return jsonb_build_object(
    'scheduled_for', candidate,
    'mode', mode_value,
    'reason', case mode_value
      when 'smart' then 'Slot terbaik dari aturan brand, histori publikasi berhasil, dan antrean aktif.'
      else 'Slot kosong terdekat dari aturan jadwal brand.'
    end
  );
end;
$$;

revoke execute on function public.recommend_content_schedule(uuid, text) from public, anon;
grant execute on function public.recommend_content_schedule(uuid, text) to authenticated;

create or replace function public.update_brand_schedule_rules(
  p_brand_id uuid,
  p_autopilot_enabled boolean,
  p_min_gap_minutes integer,
  p_posting_windows jsonb
) returns public.brand_rules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  time_text text;
  day_value integer;
  seen_days integer[] := '{}';
  result public.brand_rules;
begin
  if (select auth.uid()) is null or not private.can_edit_brand(p_brand_id) then
    raise exception 'forbidden';
  end if;
  if p_min_gap_minutes < 0 or p_min_gap_minutes > 1440 then
    raise exception 'minimum gap must be between 0 and 1440 minutes';
  end if;
  if jsonb_typeof(p_posting_windows) <> 'array'
     or jsonb_array_length(p_posting_windows) < 1
     or jsonb_array_length(p_posting_windows) > 7 then
    raise exception 'posting windows must contain one to seven days';
  end if;

  for item in select value from jsonb_array_elements(p_posting_windows) loop
    if coalesce(item->>'day', '') !~ '^[0-6]$' or jsonb_typeof(item->'times') <> 'array' then
      raise exception 'invalid posting window';
    end if;
    day_value := (item->>'day')::integer;
    if day_value = any(seen_days) then
      raise exception 'duplicate posting day';
    end if;
    seen_days := array_append(seen_days, day_value);
    if jsonb_array_length(item->'times') < 1 or jsonb_array_length(item->'times') > 4 then
      raise exception 'each day needs one to four posting times';
    end if;
    for time_text in select jsonb_array_elements_text(item->'times') loop
      if time_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'invalid posting time';
      end if;
    end loop;
  end loop;

  update public.brand_rules
  set autopilot_enabled = coalesce(p_autopilot_enabled, true),
      min_gap_minutes = p_min_gap_minutes,
      posting_windows = p_posting_windows,
      updated_at = now()
  where brand_id = p_brand_id
  returning * into result;

  if result.brand_id is null then
    raise exception 'brand schedule rules not found';
  end if;
  return result;
end;
$$;

revoke execute on function public.update_brand_schedule_rules(uuid, boolean, integer, jsonb) from public, anon;
grant execute on function public.update_brand_schedule_rules(uuid, boolean, integer, jsonb) to authenticated;

create or replace function public.schedule_content_hybrid(
  p_content_id uuid,
  p_channels text[],
  p_mode text default 'smart',
  p_scheduled_for timestamptz default null
) returns setof public.publish_jobs
language plpgsql
security definer
set search_path = ''
as $$
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

  if mode_value = 'manual' then
    if p_scheduled_for is null or p_scheduled_for <= now() then
      raise exception 'manual schedule must be in the future';
    end if;
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
    where s.brand_id = content_row.brand_id
      and s.platform = platform_value
      and s.status = 'connected'
    order by s.updated_at desc
    limit 1;
    if account_id is null then continue; end if;

    insert into public.publish_jobs(
      content_item_id, social_account_id, platform, publish_kind,
      scheduled_for, status, metadata
    ) values (
      content_row.id, account_id, platform_value, kind_value,
      candidate, 'scheduled', jsonb_build_object(
        'schedule_mode', mode_value,
        'schedule_reason', reason,
        'timezone', coalesce(rules.timezone, 'Asia/Jakarta')
      )
    )
    on conflict(content_item_id, social_account_id, publish_kind) do update
    set scheduled_for = excluded.scheduled_for,
        status = 'scheduled',
        error_message = null,
        metadata = excluded.metadata,
        updated_at = now();
    inserted_count := inserted_count + 1;
  end loop;

  if inserted_count = 0 then raise exception 'no connected account for selected channels'; end if;

  update public.content_items
  set status = 'scheduled',
      auto_schedule = mode_value <> 'manual',
      ai_metadata = coalesce(ai_metadata, '{}'::jsonb) || jsonb_build_object(
        'schedule_mode', mode_value,
        'scheduled_for', candidate,
        'schedule_reason', reason
      )
  where id = content_row.id;

  return query
  select * from public.publish_jobs j
  where j.content_item_id = content_row.id
  order by j.created_at;
end;
$$;

revoke execute on function public.schedule_content_hybrid(uuid, text[], text, timestamptz) from public, anon;
grant execute on function public.schedule_content_hybrid(uuid, text[], text, timestamptz) to authenticated;
