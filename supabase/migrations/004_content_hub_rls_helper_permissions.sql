-- Allow authenticated RLS policies to invoke only the private authorization
-- helpers they depend on. Private tables and worker-only functions remain
-- inaccessible to authenticated clients.

grant usage on schema private to authenticated;

grant execute on function
  private.is_org_member(uuid),
  private.has_org_role(uuid, text[]),
  private.brand_org(uuid),
  private.can_access_brand(uuid),
  private.can_upload_brand(uuid),
  private.can_edit_brand(uuid),
  private.can_publish_brand(uuid)
to authenticated;
