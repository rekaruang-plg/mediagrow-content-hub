-- Cover foreign keys used by internal operations and make the intentionally
-- RPC-only invitation table explicit to the database linter.

create index if not exists idx_activity_logs_organization_created
  on public.activity_logs(organization_id, created_at desc);
create index if not exists idx_activity_logs_brand
  on public.activity_logs(brand_id);
create index if not exists idx_activity_logs_user
  on public.activity_logs(user_id);
create index if not exists idx_brand_memberships_user
  on public.brand_memberships(user_id);
create index if not exists idx_brands_created_by
  on public.brands(created_by);
create index if not exists idx_content_assets_content_item
  on public.content_assets(content_item_id);
create index if not exists idx_content_items_created_by
  on public.content_items(created_by);
create index if not exists idx_content_items_reviewed_by
  on public.content_items(reviewed_by);
create index if not exists idx_organizations_created_by
  on public.organizations(created_by);
create index if not exists idx_publish_jobs_social_account
  on public.publish_jobs(social_account_id);
create index if not exists idx_workspace_invitations_invited_by
  on public.workspace_invitations(invited_by);
create index if not exists idx_workspace_invitations_accepted_by
  on public.workspace_invitations(accepted_by);

drop policy if exists "workspace invitations deny direct access" on public.workspace_invitations;
create policy "workspace invitations deny direct access"
  on public.workspace_invitations
  as restrictive
  for all
  to public
  using (false)
  with check (false);
