# needalab brand

Draft 1, 2026-11-05. Strategy first, visuals follow from it. Nothing here is final until Aayu signs off.

## What we learned (research, Nov 2026)

- **The paid market is $3,000 to $7,465.** Polygence starts near $3,000 (about $300 per contact hour), Horizon $6,950, Pioneer $7,465. Lumiere and Veritas hide their prices. (aldevere.com cost comparison, Jul 2026)
- **Students resent it.** Top r/ApplyingToCollege post this year (646 upvotes): a Yale grad student gets offers to "do research" with kids for $100/hr. Top replies: "Research for pay is the new crutch for the affluent", "ghostwritten research... it's what everyone does". Another thread warns about fake "research institutes" with slick AI-made branding.
- **Professors are tired of AI cold email** (Neubig, Orosz on X, Nov 2026). Generic AI outreach is the enemy, not the help.
- **Direct competitors look the same.** Ciphon ("cold emails professors actually read"), Research.Mail, CITEX: all "AI writes your email". Nichable lists opportunities with plain, centered SaaS styling. First Orbit sells startup internships with rocket photos and a serif headline.
- **What reads as trustworthy in this world:** Our World in Data, Distill, Quanta, arXiv, Are.na. Real data, dates, authors, citations. Quiet chrome. The content is the decoration.

## Positioning

**needalab is the free, honest way into real research.**

The paid programs sell access. We show you that the access was public all along: who is publishing on your topic this month, what they wrote, how to reach them, and how to write something worth reading.

- **For:** high school and early college students who want real research experience and can't or won't pay $5,000 for it.
- **Against:** pay-to-play research mentorship, fake research institutes, and AI-slop cold email.
- **Proof, not promises:** every claim on the page is a real paper, a real date, a real professor. No testimonials we can't verify.

One line: *Real labs, real papers, no $5,000 program.*

## Audience

| Who | What they need | What they fear |
|---|---|---|
| Primary: ambitious high schoolers, 15 to 18, mostly US, often first-gen or without academic parents | A lab working on their topic, and the nerve to email | Looking dumb to a professor, being ignored, getting scammed |
| Secondary: first and second year undergrads looking for a lab | Same, faster | Same |
| Influencer: parents, school counselors | A free, legitimate alternative to paid programs | Scams, wasted money |
| Supply side (later): professors | Fewer, better emails from prepared students | Spam |

## Scope decision: research or also internships?

**Research only, for now.** Reasons:
1. The research angle is the one with a clear enemy (pay-to-play) and a moat (our professor data, OpenAlex, hs_mentors, grants, shared email records). Internships is crowded (Simplify, Handshake, Ladder, First Orbit, Nichable) and needs a different supply side (companies).
2. "needalab" literally says lab. Stretching to internships muddies the name.
3. Later extension that stays on brand: **research internships at companies with R&D** (biotech, climate, robotics startups), found the same way, through their published work and patents. That keeps "find the people doing the work" as the one idea.

## Personality

- **Character:** precise, generous, a little irreverent toward gatekeepers.
- **World:** the stacks. Index cards, call numbers, reference lists, the margin notes in a used textbook. A library is the original free access to knowledge, which is the whole point.
- **Voice:** a smart older student who already did this and is telling you how. Plain words, specific numbers, no hype. Never "unlock", "supercharge", "AI-powered".
  - Yes: "Kaitlyn Becker at MIT published on soft actuators in March. Here's her paper and her email."
  - No: "Discover your dream research opportunity with AI ✨"

## Visual identity

- **Signature:** the citation line. Every professor, paper and result is set like a reference: `Becker, K. · MIT · 2026 · Soft Robotics`. Mono figures, real data. It's the one detail only we use, everywhere.
- **Moment:** a real result card (professor, three papers, the first line of a drafted email) as the hero visual, not an illustration.
- **Color:** paper and ink. A warm off-white page, near-black ink, one accent. Proposed accent: library-card red or a deep green (pick in visuals round). No gradients, no glow, no blue grid.
- **Type:** one text family plus a mono for citations. Candidate pairs to test: IBM Plex Sans + Plex Mono (technical, free), or Newsreader for display + Inter for text (editorial).
- **Logo:** wordmark first. A mark only if it earns it (candidates: an index-card corner, a call-number tag, a magnifier over a dot).
- **Shape:** 6 to 10px radius on controls, 12 on cards. Pills only for tags.
- **Motion:** almost none. The chat dock keeps its bubbles as the one living element.

## Stack plan (for the rebuild)

Keep it boring and free:
- Static site on GitHub Pages, plain HTML, CSS and ES modules. No framework needed for one page plus panels.
- One `tokens.css` generated from this doc (color, type, space, radius), imported first. Delete the CSRankings/Bootstrap CSS layers instead of overriding them (also fixes the CC BY-NC-ND license problem).
- Supabase backend unchanged.
- Fonts self-hosted (woff2, subset) instead of Google Fonts, for speed and privacy.
- Generated brand assets saved to `brand/` in the repo, with prompts recorded next to them.
