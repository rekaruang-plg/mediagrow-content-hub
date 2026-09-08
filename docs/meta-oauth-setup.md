# Meta OAuth setup — MediaGrow Content Hub

This flow connects brand publishing accounts. It does not replace the team's Supabase login.
One Meta application can serve many brands, after the required Meta permissions and reviews.

## Deployment values

| Setting | Value |
| --- | --- |
| Production site | `https://mediagrow-content-hub.vercel.app` |
| Meta App ID | `1350438086849056` |
| OAuth redirect URI | `https://mediagrow-content-hub.vercel.app/api/meta/callback` |
| App domain | `mediagrow-content-hub.vercel.app` |

In Vercel, open the **mediagrow-content-hub** project → **Settings → Environment Variables**.
Add `META_APP_SECRET` from Meta's **App settings → Basic → App secret**, scoped to Production.
Do not paste it in chat, GitHub, screenshots, or a `NEXT_PUBLIC_` variable. Redeploy after saving it.
The site URL and App ID above are the defaults; `.env.example` documents optional overrides.
No Supabase service-role key is needed on Vercel.

## Meta settings

1. Keep the Instagram content and Facebook Pages use cases enabled.
2. Configure **Instagram API with Facebook Login / Facebook Login for Business**.
3. In its login settings, enable web OAuth login and add the exact redirect URI above under
   **Valid OAuth Redirect URIs**. Use the same URI for start and code exchange.
4. Add the app domain above and use the production site URL when Meta asks for a website URL.
5. Required permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
   `instagram_basic`, `instagram_content_publish`.
6. If the dashboard requires a Facebook Login for Business configuration, create a configuration
   using **user access tokens** and the permissions above. Set its configuration ID in
   `META_LOGIN_CONFIG_ID` in Vercel, then redeploy. Do not choose the WhatsApp or conversions template.
7. For initial testing, use eligible app-role/test accounts with publishing access to the Page.
   Instagram must be professional and linked to the selected Page for this login method.

The separate Instagram Login product uses different tokens/API hosts and is not implemented by
this patch. Do not substitute its Instagram App ID or redirect settings for Facebook Login.

Before onboarding external clients, complete the business verification, access verification and
App Review/Advanced Access required by Meta. An app that works for its admin is not proof that
external clients can use it. Supply real privacy, terms and data-deletion pages describing this
service. Public pages are available without login at:

- Privacy Policy URL: `https://mediagrow-content-hub.vercel.app/privacy`
- Terms of Service URL: `https://mediagrow-content-hub.vercel.app/terms`
- User Data Deletion: select **Data Deletion Instructions URL**, then enter
  `https://mediagrow-content-hub.vercel.app/data-deletion` (this is an HTML instructions page,
  not a signed-request callback endpoint).

The contact is the app's configured contact email, `racingpempek@gmail.com`. The operator must
monitor it and handle verified deletion requests, including database records, uploaded files and
pending jobs within the confirmed scope. There is no automatic deletion worker or promised
turnaround in this patch. Review these pages against actual operations before submitting them.
Publishing these pages does not mean Meta has approved the app or all permissions.

## Test as an owner/admin

1. Log in to Content Hub, open **META**, and explicitly select a brand.
2. Click **Hubungkan lewat Facebook**, log in to a Facebook user with publishing access, and
   grant the requested access to the appropriate Page.
3. Back in Content Hub, choose that Page and check the Facebook/Instagram accounts to connect.
4. Confirm that the displayed brand and account names are correct, then connect.
5. Verify the saved account list. A missing Page, missing permission or unlinked Instagram should
   show an explanation; do not fix it by using an ID belonging to a different Page.
6. Repeat for another brand. If it has a different Facebook administrator, log out of Facebook or
   use a separate browser profile before starting that brand's connection.
7. Test cancellation, expired sessions, and a non-admin workspace account. These must not save accounts.

Connecting accounts does not create jobs or publish content. Existing `ready` content is not
automatically rescheduled. The existing scheduler still selects the most recently connected account
per brand/platform for new jobs; existing jobs retain their original target account.
A real posting test is separate: verify its target, media and schedule before creating a job,
because the existing worker/cron will publish due jobs.

## Security and limits

### Empty Page list

The account chooser displays a safe, fixed list of permission names and whether the current
Meta token has each grant. It does not expose access tokens, raw provider errors or user IDs.
If Meta returns zero Pages and `business_management` is absent, the user can explicitly select
**Hubungkan ulang dengan izin bisnis**. This starts a new, authenticated owner/admin OAuth
flow for the same brand, adding `business_management` to the requested scopes. Enable this
permission in the Meta dashboard for eligible testers or obtain the access required for clients.
This is a troubleshooting option for business-managed Page access, not a guarantee that an empty
response is caused by this permission. No Business Manager assets are modified by the application.

When `META_LOGIN_CONFIG_ID` is set, configure that permission in the Meta login configuration;
the application will not silently bypass `config_id` by substituting a different login flow.
The Page listing endpoint remains `/me/accounts`; alternate business Page endpoints are not
implemented. If the diagnostic shows the grant but no Pages, investigate asset assignment and
provider responses rather than repeating the same consent flow indefinitely.

### Session protection

- Start/connect/cancel require a validated Supabase bearer token and same-origin POST.
- Owner/admin access is rechecked against database memberships at start, callback and save.
- Random OAuth state is bound to an AES-GCM authenticated, HttpOnly, Secure, SameSite=Lax cookie.
  Temporary credentials expire after ten minutes, are never returned as plaintext to frontend code,
  and are removed from the cookie after completion/cancellation. Changing the App Secret invalidates
  in-progress sessions. Starting another connection in another tab replaces the first session.
- Account IDs and Page tokens are re-fetched from Meta on save; browser-supplied token/brand overrides
  are not accepted. The RPC saves both selected accounts in one database transaction and relies on
  the existing owner/admin checks and encrypted token storage.
- Meta errors are sanitized. OAuth responses use no-store/no-referrer. No provider token is placed
  in application redirect URLs or localStorage. Operator infrastructure should not log OAuth query
  strings: Meta returns a short-lived authorization code in the callback URL.
- Pagination uses a fixed Graph host and opaque cursors, not provider-supplied next URLs. There is
  an explicit 1,000-Page cap; exceeding it fails with a message rather than silently hiding Pages.
- Page tokens are stored with the upstream user-token expiry as a conservative reconnect reminder
  when Meta supplies one. There is no background Meta token refresh in this patch.
- Missing `META_APP_SECRET` leaves the connect button disabled with a setup message.

Run `npm test`, `npm run typecheck`, and `npm run build`. Automated tests mock Meta and Supabase
transport, so they do not prove that real permissions, credentials, App Review or publishing work.

## Official references

- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram
- https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived
- https://developers.facebook.com/documentation/instagram-platform/app-review
- https://supabase.com/docs/reference/javascript/auth-getuser
