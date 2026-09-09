# MediaGrow Content Hub V1

Multi-brand social content inbox and auto-publisher for Instagram and Facebook.

## V1 flow

1. Team signs in with Supabase Auth.
2. Owner creates brands.
3. Owner/admin selects a brand, signs in through Facebook, selects its Page and linked Instagram, and confirms the accounts.
4. Team uploads an image/video to the private `content-media` bucket.
5. The team chooses **Smart**, **Auto**, or **Manual** scheduling. `schedule_content_hybrid()` creates independent publish jobs for every connected selected channel.
6. Supabase Cron invokes `publish-worker` every minute.
7. Worker claims jobs atomically (`FOR UPDATE SKIP LOCKED`), creates a signed media URL, publishes to Meta, and records the post ID/URL.
8. Failed jobs retry with exponential backoff, max 4 attempts.

## Security

- Browser only gets the Supabase publishable key.
- All public tables use RLS.
- Media bucket is private.
- Meta access tokens are encrypted with `pgcrypto` before storage.
- Decryption functions are executable only by `service_role`.
- Publish worker uses a custom random secret stored in the private schema.
- OAuth requires `META_APP_SECRET` on the Vercel server; no Supabase service-role key is needed there.
- Temporary OAuth sessions use authenticated encryption, HttpOnly cookies and a ten-minute expiry.

## Deploy

### Supabase

Apply migrations in order:

1. `supabase/migrations/001_content_hub.sql`
2. `supabase/migrations/002_content_hub_functions.sql`
3. `supabase/migrations/003_content_hub_security.sql`
4. `supabase/migrations/004_content_hub_rls_helper_permissions.sql`
5. `supabase/migrations/005_content_hub_storage_policy_path_fix.sql`
6. `supabase/migrations/20260907160848_content_hub_meta_oauth_batch.sql`
7. `supabase/migrations/20260908030541_hybrid_content_scheduling.sql`
8. `supabase/migrations/20260908045147_internal_content_operations.sql`
9. `supabase/migrations/20260908053000_internal_operations_indexes.sql`
10. `supabase/migrations/20260908053500_internal_operations_scope_hardening.sql`
11. `supabase/migrations/20260908110000_brand_kit.sql`
12. `supabase/migrations/20260908165338_carousel_and_story_assets.sql`

Then deploy `supabase/functions/publish-worker` with JWT verification disabled **only because the function performs its own `x-worker-secret` check**, and run `supabase/scheduler.example.sql`.

Create the first user from the web UI. If email confirmations are enabled, confirm the email first.

### Vercel

The project supports public Supabase URL + publishable key through environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Meta connection

The connection screen uses Facebook OAuth and explicit Page/Instagram selection per brand.
Follow [the OAuth setup guide](docs/meta-oauth-setup.md) for the App Secret, exact callback URL,
permissions, test accounts, and external-client review requirements. Until the secret is configured,
the screen explains that login has not been activated. Connecting accounts does not schedule existing content.

Validation: `npm test` (mocked OAuth/API security tests), `npm run typecheck`, `npm run build`.
Real Meta login and publishing require configured credentials and separate verification.

Supported worker paths in V1:

- Instagram image Feed
- Instagram image Carousel (2–10 slides)
- Instagram image/video Story
- Instagram Reel
- Facebook image/video Feed
- Facebook image Carousel (2–10 slides)
- Facebook image/video Story
- Facebook Reel

Meta permissions and account eligibility still determine whether a specific account can publish via API.

## Scheduling modes

- **Smart** scores the configured brand slots using successful publishing history, common high-attention time ranges, distance from today, and active queue spacing.
- **Auto** selects the next open slot from the brand's weekly posting windows.
- **Manual** uses the exact future date and time selected by the team.

The Brand screen controls autopilot, minimum spacing, and one to four posting times for each day. The Calendar screen shows the resulting weekly queue in Asia/Jakarta time. Smart recommendations are transparent and rules-based; they do not call an external AI provider or create additional usage charges.

## Internal team workflow

- A brand can require approval before any publish job is created. Uploaders send content to the approval queue; an owner, admin, or publisher can approve it or return it with revision notes.
- Content stores its requested channels and scheduling mode. Approval automatically creates the intended jobs using the latest brand rules.
- The calendar can reschedule or cancel queued jobs. Failed jobs can be retried manually after the underlying Meta issue is fixed.
- The content library opens a signed, short-lived media preview and allows editable content to be updated and resubmitted.
- The Team screen creates seven-day, email-bound invitation links and assigns workspace roles plus per-brand access.
- The Activity screen records content, schedule, publication, team, and brand-rule changes without exposing Meta tokens.

## Brand operations

- The Brand screen stores a Brand Kit for every client: audience, tone of voice, CTA, hashtag guidance, content pillars, and prohibited claims.
- Brand Kit edits follow brand-level access rules and are written to the activity history.
- Upload inspects the selected image or video in the browser before storage. Blocking errors cover incompatible media/channel combinations, while crop and quality risks are shown as warnings.
- The Notifications screen derives an actionable inbox from pending reviews, requested revisions, failed publish jobs, disconnected accounts, and tokens nearing expiry. An alert disappears automatically when its source issue is resolved.

## Automatic captions

- Upload can generate three Indonesian caption alternatives for Education, Soft Selling, or Promotion objectives.
- The server combines the selected brand, title, brief, content format, destination channels, and Brand Kit. It never sends the uploaded media to the caption model.
- Generated captions remain editable and still follow the normal approval/scheduling workflow. Story text is stored as copy reference and is not rendered onto the media.
- Vercel deployments authenticate AI Gateway with project OIDC automatically. For local generation, link the project and run `vercel env pull`, or set `AI_GATEWAY_API_KEY` locally. `AI_CAPTION_MODEL` can optionally override the default model.
- Requests require a valid Supabase user token, run brand queries under RLS, enforce short input limits, filter prohibited Brand Kit terms, and ask AI Gateway not to route prompts to training-enabled providers.
- If AI Gateway is temporarily unavailable, the endpoint returns three Brand Kit-based templates so the upload flow can continue.
