# Google verification demo video (record with Compound)

Goal: show Google how needalab uses the `gmail.send` scope. Upload as an **unlisted YouTube** video and paste the link in the verification form. Target 2 to 3 minutes. Google reviewers watch for: the real domain, the real consent screen with the scope, and the feature that uses it.

## Before you hit record
1. Open Chrome, signed in to Google as aayu22809@gmail.com.
2. Go to **https://needalab.com/?gmail=1** once (turns on the hidden "Send from Gmail" button in this browser only).
3. Make sure you have a saved professor with a draft. For the demo, set **Their email** to **your own second address** (or aayu22809@gmail.com) so the test email lands with you, not a real professor.
4. Compound: record the **Chrome window** with the address bar visible, cursor highlight on, mic on. 1080p.

## Shot list (say the line in quotes)
| # | Show | Say |
|---|------|-----|
| 1 | Address bar on https://needalab.com, homepage. | "This is needalab. It helps students find research labs and draft an email to the professor." |
| 2 | Click **Continue with Google**, sign in. | "Users sign in with Google. Sign-in only asks for name and email." |
| 3 | Footer: click **Privacy**, scroll to the "Google user data" section, then back. | "Our privacy policy explains how we use Google data, including the Limited Use policy." |
| 4 | Open **My list**, show a saved professor and the draft (To, Subject, body). | "A student saves a professor and we draft an email. They can edit it." |
| 5 | Click **Send from Gmail**. Confirm dialog shows To + Subject. Click OK. | "When they choose to send it from their own Gmail, we first confirm the recipient and subject." |
| 6 | Google consent popup. **Pause 3 to 4 seconds** on it so the app name and the "Send email on your behalf" permission are readable. Click Continue/Allow. | "This is the only time we ask for Gmail access, and only the send permission. We never read the inbox." |
| 7 | Toast "Sent from …", the card moves to **Sent**. | "The email is sent from the student's own account to the professor they chose." |
| 8 | Open Gmail in a new tab → **Sent** folder → open the message. | "Here it is in their Sent folder." |
| 9 | Back on needalab: account bar → **Disconnect Gmail**. | "Users can disconnect Gmail any time, which revokes our access." |

## Notes
- Expect an "unverified app" warning on step 6 until Google approves. That's fine for the video; click Advanced → Go to needalab.
- Keep the URL bar in frame for steps 1, 5 to 7. Don't show other tabs with personal info.
- Each Google account that grants Gmail access counts toward a permanent 100-user cap until verified, so record with just your own account.

## Then submit
Google Cloud → project **needalab-auth** → Google Auth Platform → **Verification center** → Submit. Use this scope justification:

> needalab drafts outreach emails from students to professors. With gmail.send, a signed-in student can send a draft they reviewed and chose to send, from their own Gmail account, to the professor saved in their list. We request only gmail.send (no read access), ask for it only when the user clicks "Send from Gmail", show the recipient and subject before sending, store the refresh token encrypted, and let users disconnect at any time. Data is handled per the Google API Services User Data Policy, including Limited Use.
