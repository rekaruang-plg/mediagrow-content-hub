-- Save a selected Facebook Page and its linked Instagram atomically.
-- This wrapper retains caller privileges; the existing RPC checks owner/admin
-- access and encrypts each token. It never schedules or publishes content.
create or replace function public.connect_meta_accounts(p_brand_id uuid, p_accounts jsonb)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account jsonb;
  connected uuid[] := array[]::uuid[];
  platforms text[] := array[]::text[];
begin
  if (select auth.uid()) is null then raise exception 'unauthorized'; end if;
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'array' then
    raise exception 'accounts must be an array';
  end if;
  if jsonb_array_length(p_accounts) not between 1 and 2 then
    raise exception 'select one or two accounts';
  end if;
  for account in select value from jsonb_array_elements(p_accounts) loop
    if jsonb_typeof(account) <> 'object'
       or coalesce(account->>'platform', '') not in ('facebook', 'instagram')
       or coalesce(account->>'external_account_id', '') !~ '^[0-9]+$'
       or length(coalesce(account->>'access_token', '')) not between 1 and 16384 then
      raise exception 'invalid account';
    end if;
    if (account->>'platform') = any(platforms) then
      raise exception 'only one account per platform per request';
    end if;
    platforms := array_append(platforms, account->>'platform');
    connected := array_append(connected, public.connect_social_account(
      p_brand_id,
      (account->>'platform')::public.social_platform,
      account->>'external_account_id',
      account->>'access_token',
      account->>'username',
      account->>'display_name',
      (account->>'token_expires_at')::timestamptz,
      coalesce(account->'capabilities', '{}'::jsonb)
    ));
  end loop;
  return connected;
end;
$$;

revoke all on function public.connect_meta_accounts(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.connect_meta_accounts(uuid, jsonb) to authenticated;
