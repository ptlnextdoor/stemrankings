# Gmail `gmail.send` OAuth verification

"Send from my Gmail" lets a student send an outreach email from their own Gmail account. It uses
the Gmail API scope `https://www.googleapis.com/auth/gmail.send`, which Google classifies as a
**sensitive** scope (not restricted). Sensitive scopes require **app verification** (OAuth brand
review) before the consent screen can be shown to users outside your test-user list.

The feature ships **dark** behind `window.NEEDALAB_FLAGS.gmailSend` (default `false`) so nothing
is user-visible until verification is approved and the flag is flipped.

---

## 1. What the coordinator must set up first

**Google Cloud project / OAuth client**
- Create (or reuse) a Google Cloud project, enable the **Gmail API**.
- OAuth consent screen: **External**, publishing status starts at **Testing**.
- Create an **OAuth 2.0 Client ID** of type **Web application**.
  - Authorized JavaScript origins: `https://needalab.com` (and `http://localhost:8000` for local dev).
  - No redirect URI is needed for the GIS code flow (it uses `postmessage`), but Google's console
    requires at least one; add `https://needalab.com`.
- Put the client ID into `js/account.js` `GOOGLE_CLIENT_ID` and keep the client **secret** server-side.

**Supabase edge function secrets** (never in the browser):
```
supabase secrets set GOOGLE_CLIENT_ID=<client id>
supabase secrets set GOOGLE_CLIENT_SECRET=<client secret>
supabase secrets set GMAIL_TOKEN_KEY=<random 32+ char passphrase>   # AES-GCM key for refresh tokens
```
`GMAIL_TOKEN_KEY` encrypts stored refresh tokens at rest; losing it means every user must reconnect.

**Database**: apply `supabase/migrations/20261101010000_gmail_send.sql` (gmail_connections table +
`saved_professors.sent_message_id`). Deploy the `gmail` edge function.

---

## 2. Scopes requested and justification text

Only one scope is requested, and only on demand (incremental authorization) when the user first
clicks "Send from Gmail" — never at sign-in.

| Scope | Why |
|---|---|
| `.../auth/gmail.send` | Send the outreach email the student wrote, from their own Gmail, so it lands in the professor's inbox as a normal personal email (replies come back to the student). |

**Scope justification (paste into the verification form):**
> NeedaLab helps students write and send research-outreach emails to professors. After a student
> drafts an email in our app and reviews it, they click "Send from Gmail." We use gmail.send only
> to deliver that single, user-composed message from the student's own account. We never read,
> list, modify, or delete mail. We request send access incrementally, only at the moment of
> sending, and the user confirms the recipient and subject before each send.

Emphasise in the form: **send-only**, **no read access**, **incremental**, **user-initiated per
message**.

---

## 3. Homepage requirements

The homepage (`https://needalab.com`) must:
- Clearly describe what the app does, visibly and in English.
- Be owned by you (domain verified in Google Search Console under the same account).
- Link to the privacy policy.
- Not be behind a login wall for the basic description.

## 4. Privacy policy requirements

Host a privacy policy at a stable URL (e.g. `https://needalab.com/privacy`) that:
- Is linked from both the homepage and the OAuth consent screen.
- Names the app, describes what Google user data is accessed (the ability to send email on the
  user's behalf) and why.
- Explains storage: we store an encrypted Gmail refresh token and the user's Gmail address; we do
  not store message contents beyond the draft the user created in-app; users can disconnect at any
  time (which revokes the token at Google and deletes the stored row).
- Includes the **Limited Use** disclosure verbatim:

> NeedaLab's use and transfer of information received from Google APIs to any other app will adhere
> to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
> including the Limited Use requirements.

State explicitly that Google user data is **not** used for advertising, not sold, and not used to
train generalized AI models.

## 5. Demo video script (required for sensitive-scope review)

Record an unlisted YouTube video (2–4 min) showing the **real OAuth consent screen** with the
`gmail.send` scope and the full flow. Narrate each step:

1. Show the browser URL bar on `https://needalab.com` (proves the verified domain).
2. Sign in to NeedaLab (the existing Google sign-in — openid/email/profile only).
3. Open "My list", draft an outreach email to a professor, show the To/Subject/body.
4. Click **Send from Gmail**. The Google OAuth popup appears — **pause on it** so the reviewer can
   read the app name, the `gmail.send` permission, and that it matches the client ID under review.
5. Grant consent. Show the confirmation dialog (To + Subject), confirm, and the "Sent from
   you@gmail.com" toast; show the message in the sender's Gmail "Sent" folder.
6. Show **Disconnect** in the account bar removing access.

Make sure the OAuth client ID in the popup matches the one submitted for verification.

## 6. Test-users workaround (up to 100) while in Testing

While the consent screen is in **Testing**, up to **100 explicitly-added test users** can use
`gmail.send` without full verification (they'll see an "unverified app" warning they can click
through). Add the owner's and any pilot students' Google accounts under
*OAuth consent screen → Test users*. This is enough to run the needalab.com outreach pilot before
verification completes — flip `gmailSend` on only for that pilot, or keep the client ID restricted.

Do **not** click "Publish app" until you're ready for verification; publishing without an approved
sensitive scope still shows the unverified warning to everyone and risks a 100-user cap removal issue.

## 7. Expected timeline

- Brand/consent-screen review (logo, name, domain): a few days.
- Sensitive-scope verification (send-only, no restricted scopes, no CASA security assessment
  required for sensitive scopes): typically **2–6 weeks**, driven by back-and-forth over the
  privacy policy wording, the Limited Use disclosure, and the demo video. Respond fast to any
  Google follow-up email; each round adds a week.
- Restricted scopes (gmail.readonly etc.) would additionally need a CASA security assessment — we
  deliberately use **only `gmail.send`** to avoid that.

## 8. Go-live checklist

- [ ] Client ID in `js/account.js`, secrets set in Supabase.
- [ ] Migration applied, `gmail` function deployed.
- [ ] Homepage + privacy policy live with Limited Use text, domain verified.
- [ ] Demo video recorded; verification submitted and approved.
- [ ] Flip `window.NEEDALAB_FLAGS.gmailSend = true` in `index.html`.
- [ ] Run `tests/gmail.test.mjs` against the deployed function; smoke-test one real send to yourself.
