-- MediaGrow Content Hub V1
-- Designed for a fresh Supabase project. All public tables use RLS.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin create type public.member_role as enum ('owner','admin','editor','uploader','viewer'); exception when duplicate_object then null; end $$;
do $$ begin create type public.content_status as enum ('draft','ready','scheduled','publishing','posted','failed','archived'); exception when duplicate_object then null; end $$;
do $$ begin create type public.publish_status as enum ('draft','scheduled','publishing','retrying','posted','failed','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.social_platform as enum ('instagram','facebook'); exception when duplicate_object then null; end $$;
do $$ begin create type public.publish_kind as enum ('feed','story','reel'); exception when duplicate_object then null; end $$;
do $$ begin create type public.media_kind as enum ('image','video'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text, avatar_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(), primary key(organization_id,user_id)
);
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, slug text not null, niche text, timezone text not null default 'Asia/Jakarta', logo_url text,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,slug)
);
create table if not exists public.brand_memberships (
  brand_id uuid not null references public.brands(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  can_upload boolean not null default true, can_edit boolean not null default false, can_publish boolean not null default false,
  created_at timestamptz not null default now(), primary key(brand_id,user_id)
);
create table if not exists public.brand_rules (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  autopilot_enabled boolean not null default true, approval_required boolean not null default false,
  timezone text not null default 'Asia/Jakarta', tone text, default_cta text, target_audience text, hashtag_guidance text,
  posting_windows jsonb not null default '[{"day":1,"times":["11:30","18:30"]},{"day":2,"times":["09:00","18:30"]},{"day":3,"times":["11:30","18:30"]},{"day":4,"times":["09:00","18:30"]},{"day":5,"times":["11:30","18:30"]},{"day":6,"times":["10:00","18:30"]},{"day":0,"times":["10:00","18:30"]}]'::jsonb,
  enabled_channels jsonb not null default '["ig_feed","ig_story","fb_feed","fb_story"]'::jsonb,
  min_gap_minutes integer not null default 180 check(min_gap_minutes>=0), updated_at timestamptz not null default now()
);
create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(), brand_id uuid not null references public.brands(id) on delete cascade,
  platform public.social_platform not null, external_account_id text not null, username text, display_name text,
  access_token_encrypted bytea not null, token_expires_at timestamptz, capabilities jsonb not null default '{}'::jsonb,
  status text not null default 'connected' check(status in ('connected','expired','disconnected','error')),
  last_verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(brand_id,platform,external_account_id)
);
create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(), brand_id uuid not null references public.brands(id) on delete cascade,
  created_by uuid not null references auth.users(id), title text not null, brief text, caption text,
  media_type public.media_kind not null, primary_asset_path text not null, status public.content_status not null default 'draft',
  auto_schedule boolean not null default true, ai_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.content_assets (
  id uuid primary key default gen_random_uuid(), content_item_id uuid not null references public.content_items(id) on delete cascade,
  storage_path text not null, media_type public.media_kind not null, mime_type text, width integer, height integer,
  duration_seconds numeric, bytes bigint, variant text not null default 'primary', created_at timestamptz not null default now()
);
create table if not exists public.publish_jobs (
  id uuid primary key default gen_random_uuid(), content_item_id uuid not null references public.content_items(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  platform public.social_platform not null, publish_kind public.publish_kind not null, scheduled_for timestamptz not null,
  status public.publish_status not null default 'scheduled', attempts integer not null default 0, last_attempt_at timestamptz,
  published_at timestamptz, external_post_id text, external_post_url text, error_message text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(content_item_id,social_account_id,publish_kind)
);
create table if not exists public.activity_logs (
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete cascade, user_id uuid references auth.users(id) on delete set null,
  action text not null, entity_type text, entity_id text, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create index if not exists idx_brands_org on public.brands(organization_id);
create index if not exists idx_memberships_user on public.memberships(user_id);
create index if not exists idx_content_brand_created on public.content_items(brand_id,created_at desc);
create index if not exists idx_publish_due on public.publish_jobs(status,scheduled_for) where status in ('scheduled','retrying');
create index if not exists idx_publish_content on public.publish_jobs(content_item_id);

create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table if not exists private.app_secrets(key text primary key,value text not null,created_at timestamptz not null default now());
insert into private.app_secrets(key,value) values
 ('token_key',encode(gen_random_bytes(32),'hex')),
 ('worker_http_secret',encode(gen_random_bytes(32),'hex')),
 ('meta_graph_version','v26.0')
on conflict(key) do nothing;
revoke all on private.app_secrets from public,anon,authenticated;

create or replace function public.set_updated_at() returns trigger language plpgsql security invoker set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists profiles_updated_at on public.profiles; create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists organizations_updated_at on public.organizations; create trigger organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();
drop trigger if exists brands_updated_at on public.brands; create trigger brands_updated_at before update on public.brands for each row execute function public.set_updated_at();
drop trigger if exists brand_rules_updated_at on public.brand_rules; create trigger brand_rules_updated_at before update on public.brand_rules for each row execute function public.set_updated_at();
drop trigger if exists social_accounts_updated_at on public.social_accounts; create trigger social_accounts_updated_at before update on public.social_accounts for each row execute function public.set_updated_at();
drop trigger if exists content_items_updated_at on public.content_items; create trigger content_items_updated_at before update on public.content_items for each row execute function public.set_updated_at();
drop trigger if exists publish_jobs_updated_at on public.publish_jobs; create trigger publish_jobs_updated_at before update on public.publish_jobs for each row execute function public.set_updated_at();
