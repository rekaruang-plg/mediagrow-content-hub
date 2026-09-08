-- Run after the carousel/story migration. Every fixture is rolled back.
begin;

do $test$
declare
  target_brand uuid;
  owner_id uuid;
  result jsonb;
  item_id uuid;
  rejected boolean := false;
begin
  select b.id, o.created_by into target_brand, owner_id
  from public.brands b join public.organizations o on o.id = b.organization_id
  order by b.created_at limit 1;
  if target_brand is null then raise exception 'test fixture missing'; end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  update public.brand_rules set approval_required = true where brand_id = target_brand;

  result := public.create_content_with_assets(
    target_brand, 'Carousel rollback test', null, 'Caption', 'carousel',
    jsonb_build_array(
      jsonb_build_object('storage_path', target_brand::text || '/test/01.jpg', 'media_type', 'image', 'mime_type', 'image/jpeg', 'width', 1080, 'height', 1350, 'bytes', 1000),
      jsonb_build_object('storage_path', target_brand::text || '/test/02.jpg', 'media_type', 'image', 'mime_type', 'image/jpeg', 'width', 1080, 'height', 1350, 'bytes', 1000)
    ),
    array['ig_feed','fb_feed'], 'smart', null
  );
  item_id := (result->>'content_id')::uuid;
  if not (result->>'needs_review')::boolean then raise exception 'approval gate bypassed'; end if;
  if (select count(*) from public.content_assets where content_item_id = item_id) <> 2 then raise exception 'assets missing'; end if;
  if (select array_agg(position order by position) from public.content_assets where content_item_id = item_id) <> array[0,1]::smallint[] then raise exception 'asset order wrong'; end if;

  begin
    perform public.create_content_with_assets(
      target_brand, 'Bad channel test', null, null, 'story',
      jsonb_build_array(jsonb_build_object('storage_path', target_brand::text || '/test/story.jpg', 'media_type', 'image', 'mime_type', 'image/jpeg', 'width', 1080, 'height', 1920, 'bytes', 1000)),
      array['ig_feed'], 'smart', null
    );
  exception when others then rejected := true; end;
  if not rejected then raise exception 'incompatible channel accepted'; end if;
end;
$test$;

select
  has_function_privilege('authenticated', 'public.create_content_with_assets(uuid,text,text,text,text,jsonb,text[],text,timestamptz)', 'execute') as authenticated_allowed,
  not has_function_privilege('anon', 'public.create_content_with_assets(uuid,text,text,text,text,jsonb,text[],text,timestamptz)', 'execute') as anon_blocked;

rollback;
