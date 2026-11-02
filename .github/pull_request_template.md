## What this changes

<!-- One or two plain sentences. What can a user do now that they couldn't before? -->

## Should it exist?

<!-- First principles, before anything else. Answer each in a line. -->
- Who asked for this, and why?
- What's the simplest version that works? Did we build more than that?
- What did we delete or reuse instead of adding?
- Odds it works as intended (%), and the most likely way it's wrong:

## Checks before merging

- [ ] **End-to-end tests** pass (`tests/run-all.sh` + `deno test supabase/functions/`). New behavior has a test.
- [ ] **Tried it in a real browser** on desktop and phone width. Screenshots below if the UI changed.
- [ ] **Security review**: who can read/write the new data (RLS), can it cost us money if abused, is every user/AI string escaped before it hits the page, no secrets committed.
- [ ] **Code quality review** (thermo-nuclear): no giant new functions, no copy-pasted blocks, no dead code.
- [ ] **Over-engineering review** (ponytail): nothing added that the standard library, the browser or existing code already does.
- [ ] **Deslop**: no filler comments, no AI-sounding copy. User-facing text read out loud once.
- [ ] **Cost**: still free tier for non-paying users. Note any new paid API calls.
- [ ] Edge functions deployed and DB migrations applied (if any), then checked on needalab.com after merge.

## Screenshots / evidence
