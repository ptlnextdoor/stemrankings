/* STEMRankings accounts: email magic-link sign-in and a saved-professors list, backed by Supabase.
   The anon key below is public by design; Row Level Security in supabase/migrations restricts
   every user to their own rows, and profiles.plan cannot be changed from the browser. */
(function () {
  const SUPABASE_URL = "https://oxcnlommtnziwfbpxigd.supabase.co";
  const TURNSTILE_SITEKEY = "0x4AAAAAAFwx3ewnJU9KVvsk"; // public; the secret lives in Supabase Auth settings
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94Y25sb21tdG56aXdmYnB4aWdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NDkzNTcsImV4cCI6MjEwNzEyNTM1N30._6MDpHUC41GsvD6OQJsn3AXlJBAlVqkq__46QwE_JH8";
  if (!window.supabase) { console.error("supabase-js failed to load"); return; }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Small plain-text tags (same look as .pc-active) for "worked with high schoolers" and a new NSF
  // grant. p.hs / p.nsf come from the find and professor functions; tooltip holds the detail.
  function badges(p) {
    let out = "";
    if (p.hs) {
      const t = p.hs.example_title ? `e.g. ${p.hs.example_title} (${p.hs.latest_year || ""})` : "has co-authored with a high schooler";
      out += ` <span class="pc-active pc-badge" title="${esc(t)}">worked with high schoolers</span>`;
    }
    if (p.nsf) {
      const amt = p.nsf.amount ? ` ($${Number(p.nsf.amount).toLocaleString()})` : "";
      const yr = (p.nsf.start && (p.nsf.start.match(/\d{4}/) || [])[0]) || "";
      out += ` <span class="pc-active pc-badge" title="${esc((p.nsf.title || "NSF award") + amt)}">new NSF grant${yr ? " " + yr : ""}</span>`;
    }
    return out;
  }
  let user = null;
  let credits = null, plan = "free", birthYear = undefined, displayName = "", hasProfile = false;
  const ageOk = () => typeof birthYear === "number" && birthYear <= new Date().getFullYear() - 13;
  async function refreshCredits() {
    if (!user) { credits = null; return; }
    const { data } = await sb.from("profiles").select("credits_cents,plan,birth_year,display_name,profile_summary").single();
    if (data) { credits = data.credits_cents; plan = data.plan; birthYear = data.birth_year; displayName = data.display_name || ""; hasProfile = !!data.profile_summary; }
  }
  function setCredits(c) { if (typeof c === "number") { credits = c; const el = $("#credits"); if (el) el.textContent = "$" + (c / 100).toFixed(2) + " credits"; } }
  let saved = new Map(); // author_name -> row
  let drafts = new Map(); // author_name -> latest draft {subject, body, created_at}
  const openRows = new Set(); // outreach rows the user expanded this session
  let gsSkipped = false; // user clicked "I'll do it myself" this session

  // "Send from my Gmail" (feature-flagged; dark until Google verifies the gmail.send scope).
  // The coordinator fills GOOGLE_CLIENT_ID with the real OAuth client id.
  const GOOGLE_CLIENT_ID = "765170452082-hg0ivpsklstqn48ue4r8o6k7thic113a.apps.googleusercontent.com";
  const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
  const gmailEnabled = () => !!(window.NEEDALAB_FLAGS && window.NEEDALAB_FLAGS.gmailSend);
  let gmailConn = null; // { connected, gmail_address } once status is fetched

  function paintStars() {
    document.querySelectorAll(".save-star").forEach((b) => {
      const on = saved.has(b.dataset.name);
      b.textContent = b.classList.contains("pp-save") ? (on ? "\u2605 On my list" : "\u2606 Add to my list") : (on ? "\u2605" : "\u2606");
      b.classList.toggle("on", on);
      b.title = on ? "Remove from my list" : (user ? "Save to my list" : "Sign in to save");
    });
  }

  function renderBar() {
    const bar = $("#account-bar");
    setFocus();
    if (!user) {
      bar.innerHTML = `<form id="signin-form" class="signin">
        <button type="button" id="google-btn" class="google-btn"><svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.7 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Continue with Google</button>
        <span class="acct-or">or</span>
        <input id="signin-email" type="email" required placeholder="you@school.edu" aria-label="Email">
        <span id="ts-box" class="ts-box"></span>
        <button type="submit">Email me a link</button>
        <span id="signin-msg" class="acct-msg"></span></form>`;
      $("#google-btn").onclick = async () => {
        $("#signin-msg").textContent = "Opening Google...";
        const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
        if (error) $("#signin-msg").textContent = "Error: " + error.message;
      };
      // Bot check for email links only (Google sign-in doesn't need it). The Turnstile script loads the
      // first time someone focuses the email box, so most visitors never download it.
      let tsToken = null, tsLoading = null;
      const loadTurnstile = () => tsLoading ??= (window.turnstile ? Promise.resolve() : new Promise((ok, no) => {
        window.nlTsReady = ok;
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=nlTsReady&render=explicit"; s.async = true; s.onerror = no;
        document.head.appendChild(s);
      })).then(() => turnstile.render("#ts-box", { sitekey: TURNSTILE_SITEKEY, size: "flexible", appearance: "interaction-only", callback: (t) => (tsToken = t), "expired-callback": () => (tsToken = null) }));
      $("#signin-email").onfocus = () => loadTurnstile().catch(() => {});
      $("#signin-form").onsubmit = async (ev) => {
        ev.preventDefault();
        const email = $("#signin-email").value.trim();
        $("#signin-msg").textContent = "Sending...";
        try { const id = await loadTurnstile(); for (let i = 0; !tsToken && i < 40; i++) await new Promise((r) => setTimeout(r, 250)); if (!tsToken) turnstile.reset(id); }
        catch { /* script blocked: Supabase will reject and we show its message */ }
        const { error } = await sb.auth.signInWithOtp({
          email, options: { emailRedirectTo: location.origin + location.pathname, captchaToken: tsToken || undefined },
        });
        tsToken = null; if (window.turnstile) turnstile.reset("#ts-box");
        $("#signin-msg").textContent = error ? (/captcha/i.test(error.message) ? "Couldn't verify you're human. Try again, or use Continue with Google." : "Error: " + error.message) : "Check your email for a sign-in link.";
      };
    } else if (birthYear == null || !displayName) {
      // One-time onboarding: name signs the drafted emails, birth year is the COPPA gate.
      // Shown as one focused card (rest of the page hidden): 2 of 3 early signups stopped here.
      bar.innerHTML = `<form id="age-form" class="signin onboard">
        <h4>Welcome to needalab</h4>
        <p class="hint">We use your name to sign the emails we draft for you, and your birth year because accounts are for ages 13+.</p>
        ${displayName ? "" : `<label>Your full name<input id="age-name" required maxlength="80" placeholder="e.g. Alex Kim" autocomplete="name"></label>`}
        ${birthYear == null ? `<label>Birth year<input id="age-year" type="number" inputmode="numeric" min="1900" max="${new Date().getFullYear()}" required placeholder="e.g. 2008"></label>` : ""}
        <div class="onboard-actions"><button type="submit">Continue</button> <button type="button" id="age-signout" class="link-btn">Sign out</button></div>
        <span id="age-msg" class="acct-msg"></span></form>`;
      setFocus();
      $("#age-signout").onclick = () => sb.auth.signOut();
      $("#age-form").onsubmit = async (ev) => {
        ev.preventDefault();
        const patch = {};
        if ($("#age-name")) patch.display_name = $("#age-name").value.trim().replace(/\s+/g, " ");
        if ($("#age-year")) {
          const y = parseInt($("#age-year").value, 10);
          if (!(y >= 1900 && y <= new Date().getFullYear())) return ($("#age-msg").textContent = "Enter a 4-digit year.");
          patch.birth_year = y;
        }
        const { error } = await sb.from("profiles").update(patch).eq("id", user.id);
        if (error) return ($("#age-msg").textContent = "Error: " + error.message);
        if (patch.display_name) displayName = patch.display_name;
        if (patch.birth_year) birthYear = patch.birth_year;
        renderBar(); renderList(); paintStars(); renderGetStarted();
      };
    } else if (birthYear > new Date().getFullYear() - 13) {
      bar.innerHTML = `<span class="acct-msg">Sorry, you need to be 13 or older to use accounts on needalab. You can still browse the rankings and search for professors.</span>
        <button id="signout-btn">Sign out</button>`;
      $("#signout-btn").onclick = () => sb.auth.signOut();
    } else {
      bar.innerHTML = `<span class="acct-who">Hi, <b>${esc(displayName.split(" ")[0])}</b></span>
        <span class="credits" id="credits" title="Profile build $0.10, email draft $0.25">${credits == null ? "" : "$" + (credits / 100).toFixed(2) + " credits"}</span>
        <button id="billing-btn">${plan === "pro" ? "Manage plan" : "Get $10/mo plan"}</button>
        <button id="mylist-btn">My list (${saved.size})</button>
        <button id="profile-btn">My profile</button>
        <button id="signout-btn">Sign out</button>
        ${user.email === "aayu22809@gmail.com" ? `<a href="admin/" class="link-btn">Owner portal</a>` : ""}
        ${gmailEnabled() && gmailConn && gmailConn.connected ? `<span class="gmail-conn">Gmail: connected as <b>${esc(gmailConn.gmail_address)}</b> <button class="link-btn" id="gmail-disc">Disconnect</button></span>` : ""}
        <span id="billing-msg" class="acct-msg"></span>`;
      $("#signout-btn").onclick = () => sb.auth.signOut();
      $("#mylist-btn").onclick = toggleList;
      $("#profile-btn").onclick = toggleProfile;
      if ($("#gmail-disc")) $("#gmail-disc").onclick = disconnectGmail;
      // Prepare the Stripe link on hover/focus so the click just navigates. Refreshed after 20 minutes.
      let billingP = null, billingAt = 0;
      const getBilling = () => {
        if (!billingP || Date.now() - billingAt > 20 * 60e3) {
          billingAt = Date.now();
          billingP = (async () => {
            const { data: { session } } = await sb.auth.getSession();
            const r = await fetch(SUPABASE_URL + "/functions/v1/billing", { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ action: plan === "pro" ? "portal" : "checkout" }) });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            return d.url;
          })();
          billingP.catch(() => { billingP = null; });
        }
        return billingP;
      };
      const bb = $("#billing-btn");
      bb.onpointerenter = bb.onfocus = () => getBilling().catch(() => {});
      bb.onclick = async () => {
        $("#billing-msg").textContent = plan === "pro" ? "Opening billing..." : "Opening checkout...";
        try {
          const url = await getBilling();
          billingP = null; // a checkout session is single-use; prepare a fresh one next time
          location.href = url;
          // Navigation started: don't leave "Opening..." up if the user comes back (Back button / bfcache).
          setTimeout(() => { $("#billing-msg") && ($("#billing-msg").textContent = ""); }, 1500);
        } catch (e) { billingP = null; $("#billing-msg").textContent = e.message; }
      };
      // Returning via Back restores the page from cache with the old text; clear it.
      window.onpageshow = (ev) => { if (ev.persisted && $("#billing-msg")) $("#billing-msg").textContent = ""; };
    }
  }

  const STATUSES = [["saved", "Saved"], ["drafted", "Drafted"], ["sent", "Sent"], ["replied", "Replied"], ["meeting", "Meeting"], ["declined", "Declined"], ["no_reply", "No reply"]];
  const today = () => new Date().toISOString().slice(0, 10);

  function renderList() {
    const el = $("#my-list");
    if (!user || el.hidden || !ageOk()) { if (el && !ageOk()) el.hidden = true; return; }
    const rows = [...saved.values()];
    const due = rows.filter((r) => r.follow_up_on && r.follow_up_on <= today() && (r.status === "sent" || r.status === "no_reply"));
    const counts = Object.fromEntries(STATUSES.map(([k]) => [k, rows.filter((r) => (r.status || "saved") === k).length]));
    const order = Object.fromEntries(STATUSES.map(([k], i) => [k, i]));
    rows.sort((a, b) => (order[a.status || "saved"] - order[b.status || "saved"]) || a.author_name.localeCompare(b.author_name));
    const stLabel = Object.fromEntries(STATUSES);
    // One row per professor in the site's own (Bootstrap/CSRankings) style. Rows are collapsed to a
    // single line; the one you're working on (has a draft, or you open it) expands.
    el.innerHTML = `<div class="ol-head"><h4>My outreach (${rows.length})</h4>
        ${rows.length ? `<span class="ol-counts">${STATUSES.filter(([k]) => counts[k]).map(([k, l]) => `${l} ${counts[k]}`).join(" \u00b7 ")}</span>` : ""}
        ${hasProfile ? "" : `<a href="#" class="ol-cta" data-goprofile>Set up your profile first &rarr;</a>`}</div>`
      + (due.length ? `<div class="due">Follow up today: ${due.map((r) => esc(r.author_name)).join(", ")}</div>` : "")
      + (rows.length
      ? `<div class="tracker">` + rows.map((r) => {
          const st = r.status || "saved", n = esc(r.author_name);
          const open = openRows.has(r.author_name) || drafts.has(r.author_name);
          return `<article class="oc${open ? " open" : ""}" data-row="${n}">
          <div class="oc-head">
            <button type="button" class="oc-toggle" aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} ${n}">${open ? "\u25BE" : "\u25B8"}</button>
            <div class="oc-who">${r.openalex_id ? `<a href="#" class="prof-open oc-name" data-oa="${esc(r.openalex_id)}">${n}</a>` : `<span class="oc-name">${n}</span>`}
              ${r.institution ? `<span class="oc-inst">${esc(r.institution)}</span>` : ""}</div>
            <select data-field="status" aria-label="Status for ${n}">${STATUSES.map(([k, l]) => `<option value="${k}" ${st === k ? "selected" : ""}>${l}</option>`).join("")}</select>
            <button class="draft-btn" data-draft="${n}" data-inst="${esc(r.institution || "")}" data-oa="${esc(r.openalex_id || "")}">${drafts.has(r.author_name) ? "Redraft" : "Draft email"} <small>$0.25</small></button>
          </div>
          <div class="oc-body">
            <div class="oc-fields">
              <label>Their email <input type="email" data-field="contact_email" placeholder="from their faculty page" value="${esc(r.contact_email || "")}" maxlength="254"></label>
              <a href="#" class="email-find" data-find="${n}" data-inst="${esc(r.institution || "")}" data-oa="${esc(r.openalex_id || "")}" data-orcid="${esc(r.orcid || "")}">${r.contact_email ? "Re-find" : "Find email"}</a>
              <span class="email-tag" data-emailtag="${n}"></span>
              <label>Follow up <input type="date" data-field="follow_up_on" value="${r.follow_up_on || ""}"></label>
            </div>
            <input class="note" data-field="note" data-for="${n}" placeholder="Notes: what they work on, what you asked" value="${esc(r.note || "")}" maxlength="2000">
            <div class="draft-out" data-for="${n}"></div>
            <div class="oc-actions"><a href="#" class="oc-remove" data-remove="${n}">Remove from list</a></div>
          </div>
        </article>`;
        }).join("") + `</div>`
      : `<p class="ol-empty">Your list is empty. Search for a topic below, or click &#9734; next to any professor, to start your list.</p>`);
    el.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); remove(b.dataset.remove); }));
    el.querySelectorAll("[data-draft]").forEach((b) => (b.onclick = () => {
      // Open the row first so the "writing your email" progress is visible, not hidden in a collapsed row.
      openRows.add(b.dataset.draft);
      const card = b.closest(".oc"); card.classList.add("open");
      const t = card.querySelector(".oc-toggle"); t.setAttribute("aria-expanded", "true"); t.textContent = "\u25BE";
      draftEmail(b);
    }));
    el.querySelectorAll("[data-find]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); findEmail(b); }));
    el.querySelectorAll("[data-goprofile]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); requireProfile(); }));
    el.querySelectorAll(".oc-toggle").forEach((b) => (b.onclick = () => {
      const name = b.closest("[data-row]").dataset.row;
      openRows.has(name) ? openRows.delete(name) : openRows.add(name);
      const card = b.closest(".oc"), open = card.classList.toggle("open");
      b.setAttribute("aria-expanded", open); b.textContent = open ? "\u25BE" : "\u25B8";
      if (open) prefetchPapers(card.querySelector(".draft-btn"));
    }));
    // Hovering a Draft button also warms the professor's papers, so the click skips that wait.
    el.querySelectorAll(".draft-btn").forEach((b) => (b.onpointerenter = () => prefetchPapers(b)));
    el.querySelectorAll(".prof-open").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openProfessor(a.dataset.oa); }));
    el.querySelectorAll("[data-field]").forEach((inp) => (inp.onchange = () => {
      const name = inp.dataset.for || inp.closest("[data-row]").dataset.row;
      updateRow(name, { [inp.dataset.field]: inp.value || null });
    }));
    for (const [name, d] of drafts) { const out = el.querySelector(`.draft-out[data-for="${CSS.escape(name)}"]`); if (out) showDraft(out, name, d); }
    // Show the status of an already-saved email (verified / maybe / yours) plus a "Bounced?" link.
    for (const r of rows) {
      if (!r.contact_email) continue;
      const tag = el.querySelector(`[data-emailtag="${CSS.escape(r.author_name)}"]`);
      if (!tag) continue;
      const st = r.contact_email_status;
      const label = st === "verified" ? "verified" : st === "maybe" ? "maybe (best guess)" : st === "yours" ? "your entry" : null;
      if (!label) continue;
      tag.className = "email-tag conf-" + (st === "verified" ? "high" : st === "maybe" ? "low" : "none");
      tag.innerHTML = `${esc(label)} ${bouncedLink(r.author_name)}`;
      wireBounced(tag, r.author_name);
    }
  }

  // Email-client style preview: editable, copyable, opens straight in Gmail or the default mail app.
  function showDraft(out, name, d) {
    const row = saved.get(name) || {};
    const to = row.contact_email || "";
    out.innerHTML = `<div class="draft">
      <div class="draft-meta"><span>To</span><input class="d-to" type="email" value="${esc(to)}" placeholder="paste their email from the faculty page"></div>
      <div class="draft-meta"><span>Subject</span><input class="d-subj-in" value="${esc(d.subject)}"></div>
      <span class="d-subj" hidden>${esc(d.subject)}</span>
      <textarea class="d-body-in" rows="6">${esc(d.body)}</textarea>
      <pre class="d-body" hidden>${esc(d.body)}</pre>
      <div class="draft-bar">
        <button class="draft-btn" data-act="copy">Copy email</button>
        <a class="btn" data-act="gmail" target="_blank" rel="noopener">Open in Gmail</a>
        <a class="btn" data-act="mail">Mail app</a>
        ${gmailEnabled() ? `<button class="draft-btn d-send" data-act="send">\u2709 Send from Gmail</button>` : ""}
        <span class="draft-wc"></span>
        <span class="d-send-msg" role="status"></span>
      </div>
      <small class="hint">Read it once and fix anything that's off. Every claim comes from your profile, but you're the one sending it.</small></div>`;
    const subj = out.querySelector(".d-subj-in"), body = out.querySelector(".d-body-in"), toIn = out.querySelector(".d-to");
    const wc = out.querySelector(".draft-wc"), gmail = out.querySelector('[data-act="gmail"]'), mail = out.querySelector('[data-act="mail"]');
    const sync = () => {
      body.style.height = "auto"; body.style.height = body.scrollHeight + 4 + "px"; // show the whole email, no inner scroll
      Object.assign(d, { subject: subj.value, body: body.value }); // keep edits if the list re-renders
      out.querySelector(".d-subj").textContent = subj.value; out.querySelector(".d-body").textContent = body.value;
      wc.textContent = body.value.trim().split(/\s+/).length + " words";
      const q = (o) => Object.entries(o).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
      gmail.href = "https://mail.google.com/mail/?" + q({ view: "cm", fs: 1, to: toIn.value, su: subj.value, body: body.value });
      mail.href = "mailto:" + encodeURIComponent(toIn.value) + "?" + q({ subject: subj.value, body: body.value });
    };
    [subj, body, toIn].forEach((x) => (x.oninput = sync));
    toIn.onchange = () => toIn.value && updateRow(name, { contact_email: toIn.value });
    out.querySelector('[data-act="copy"]').onclick = (e) => copy(`Subject: ${subj.value}\n\n${body.value}`, e.target);
    const sendBtn = out.querySelector('[data-act="send"]');
    if (sendBtn) sendBtn.onclick = () => sendFromGmail(name, out, subj, body, toIn);
    sync();
  }

  async function updateRow(name, patch) {
    if (patch.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(patch.contact_email)) return alert("That email address doesn't look right.");
    const prev = saved.get(name) || {};
    // The user typed an email directly into the field: that's their own, mark it 'yours'.
    if ("contact_email" in patch && patch.contact_email && !("contact_email_status" in patch)) patch.contact_email_status = "yours";
    const { data, error } = await sb.from("saved_professors").update(patch).eq("author_name", name).select().single();
    if (error) return alert("Could not save: " + error.message);
    saved.set(name, data);
    // When a professor is marked replied/meeting and the email came from the finder (verified/maybe),
    // tell the shared record it worked (fire and forget, one confirm per user).
    if (patch.status && ["replied", "meeting"].includes(patch.status) && !["replied", "meeting"].includes(prev.status || "")
        && data.contact_email && ["verified", "maybe"].includes(data.contact_email_status)) {
      callFindEmail({ action: "confirm", author_name: name, institution: data.institution || undefined, openalex_id: data.openalex_id || undefined, email: data.contact_email }).catch(() => {});
    }
    if ("status" in patch) renderList(); // status change can set sent_at / follow-up date server-side
  }

  function toggleList() { const el = $("#my-list"); el.hidden = !el.hidden; renderList(); }

  // ---- Guided "Get started" flow: one screen from onboarding to drafted emails ----
  const PROFILE_CENTS = 10, DRAFT_CENTS = 25, MAX_UPLOAD_MB = 5;
  // Remaining emails affordable after paying for the profile build.
  function maxDrafts() { const left = (credits ?? 0) - PROFILE_CENTS; return Math.max(0, Math.floor(left / DRAFT_CENTS)); }
  const showGetStarted = () => !!user && ageOk() && !hasProfile && !gsSkipped && saved.size === 0;
  // Focus mode: onboarding (name + birth year) blocks everything else, so while it's showing it is the
  // only thing on screen. Get started stays inline because it's skippable.
  function setFocus() {
    const onboarding = !!user && (birthYear === null || (birthYear !== undefined && !displayName));
    document.body.classList.toggle("focus-mode", onboarding);
  }

  async function runRawFind(query, country) {
    const { data: { session } } = await sb.auth.getSession();
    const headers = { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY };
    if (session) headers.Authorization = "Bearer " + session.access_token;
    const r = await fetch(SUPABASE_URL + "/functions/v1/find", { method: "POST", headers, body: JSON.stringify({ query, country: country || undefined, years: 3 }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Search failed");
    return d.professors || [];
  }

  function renderGetStarted() {
    const el = $("#get-started");
    if (!el) return;
    if (!showGetStarted()) { el.hidden = true; el.innerHTML = ""; setFocus(); return; }
    el.hidden = false; setFocus();
    const cap = maxDrafts();
    el.innerHTML = `<div class="gs">
      <div class="gs-head"><h4>Get started: set up your profile</h4>
        <button type="button" class="link-btn gs-skip">Skip, I'll do it myself</button></div>
      <p class="hint">Paste your resume (or drop PDFs). Save it as your profile, or also find professors and draft emails right now. <b>$0.10</b> for your profile + <b>$0.25</b> per email · you have <b>$${((credits ?? 0) / 100).toFixed(2)}</b>${cap ? `, enough for ${cap} email${cap === 1 ? "" : "s"}` : ""}.</p>
      <form id="gs-form" class="gs-form">
        <label class="gs-lbl">Your resume or bio
          <textarea id="gs-text" rows="5" maxlength="60000" placeholder="Paste your resume or a short bio. e.g. Senior at Cupertino High. Built an EEG forecasting model and a robotic arm. Python, Teensy."></textarea></label>
        <div class="gs-file"><span>or drop PDFs:</span> <input id="gs-pdf" type="file" accept=".pdf,.txt,.md" multiple> <small>up to ${MAX_UPLOAD_MB} MB total</small></div>
        <div class="gs-actions">
          <button type="button" class="draft-btn" id="gs-save">Save my profile</button>
          <span class="gs-or">or</span>
          <span class="gs-findrow">
            <input id="gs-topic" maxlength="200" placeholder="what you want to research, e.g. EEG brain-computer interfaces" aria-label="What do you want to research?">
            <select id="gs-country" aria-label="Where">${$("#find-country") ? $("#find-country").innerHTML : '<option value="US">United States</option>'}</select>
            <button type="submit" class="draft-btn" id="gs-go">Save + find professors</button>
          </span>
        </div>
        <span id="gs-msg" class="acct-msg"></span>
      </form>
      <div id="gs-out"></div></div>`;
    el.querySelector(".gs-skip").onclick = () => { gsSkipped = true; renderGetStarted(); };
    $("#gs-form").onsubmit = gsFindStep;
    $("#gs-save").onclick = gsSaveOnly;
  }

  // Reads the pasted text or uploaded files into one string. Shared by Get started and My profile so the
  // size limit lives in one place. Files are parsed in the browser; only text goes to the server.
  async function readFiles(fileInput, pasted) {
    const files = [...(fileInput?.files || [])];
    const total = files.reduce((a, f) => a + f.size, 0);
    if (total > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`Those files add up to ${(total / 1048576).toFixed(1)} MB. Keep it under ${MAX_UPLOAD_MB} MB total.`);
    const parts = [];
    for (const f of files) parts.push(f.name.toLowerCase().endsWith(".pdf") ? await pdfToText(f) : await f.text());
    if (pasted) parts.unshift(pasted);
    const text = parts.filter(Boolean).join("\n\n").trim();
    if (text.length > 60000) throw new Error("That's a lot of text. Trim it to your resume and 1 or 2 key projects.");
    return { text, names: files.map((f) => f.name) };
  }

  // Shared first half of both buttons: save the resume and build the profile ($0.10).
  async function gsBuildProfile(msg) {
    msg.textContent = "Reading\u2026";
    const { text, names } = await readFiles($("#gs-pdf"), $("#gs-text").value.trim());
    if (!text) throw new Error("Paste your resume/bio or drop a PDF.");
    msg.textContent = "Building your profile\u2026";
    const { error } = await sb.from("user_docs").insert({ kind: "resume", title: names.join(", ").slice(0, 200) || "Resume", content: text });
    if (error) throw error;
    return callDraft({ action: "profile" });
  }

  // "Save my profile": profile only. Professors come later from search or the rankings table.
  async function gsSaveOnly() {
    const msg = $("#gs-msg"), btn = $("#gs-save");
    btn.disabled = $("#gs-go").disabled = true;
    try {
      const d = await gsBuildProfile(msg);
      setCredits(d.credits_cents); hasProfile = true; gsSkipped = true;
      renderBar(); renderGetStarted();
      toast("Profile saved. Search for a topic or open any professor to draft an email.");
      $("#find-q") && $("#find-q").focus();
    } catch (e) { msg.textContent = e.message; btn.disabled = $("#gs-go").disabled = false; }
  }

  // Step 2: build profile + search in parallel, then show top-5 cards with checkboxes.
  async function gsFindStep(ev) {
    ev.preventDefault();
    const msg = $("#gs-msg"), out = $("#gs-out");
    const topic = $("#gs-topic").value.trim();
    if (topic.length < 3) { msg.textContent = "Type what you want to research (or just save your profile)."; $("#gs-topic").focus(); return; }
    $("#gs-go").disabled = $("#gs-save").disabled = true;
    try {
      out.innerHTML = `<div class="draft-loading"><span class="spinner"></span>Building your profile and searching recent papers\u2026</div>`;
      const [profRes, profs] = await Promise.all([
        gsBuildProfile(msg),
        runRawFind(topic, $("#gs-country").value),
      ]);
      setCredits(profRes.credits_cents); hasProfile = true;
      renderBar();
      const top = profs.slice(0, 5);
      if (!top.length) { out.innerHTML = `<p>No active labs found for "<b>${esc(topic)}</b>". Try broader words, then use the search box below.</p>`; msg.textContent = ""; return; }
      gsRenderPicks(top);
    } catch (e) { msg.textContent = e.message; out.innerHTML = ""; $("#gs-go").disabled = $("#gs-save").disabled = false; }
  }

  // Step 2b/3: professor cards with pre-checked boxes, capped by remaining credits, then draft.
  function gsRenderPicks(profs) {
    const out = $("#gs-out"), msg = $("#gs-msg");
    msg.textContent = "";
    const cap = Math.min(profs.length, Math.max(1, maxDrafts()));
    out.innerHTML = `<p class="hint">Top ${profs.length} professors for your topic. We've pre-selected the first ${cap} (your credits cover ${maxDrafts()} email${maxDrafts() === 1 ? "" : "s"} at $0.25 each).</p>
      <div class="gs-picks">${profs.map((p, i) => `<label class="gs-pick"><input type="checkbox" value="${i}" ${i < cap ? "checked" : ""}>
        <span class="gs-pick-b"><b>${esc(p.name)}</b> <span class="pc-inst">${esc(p.institution || "")}</span>
        <small class="pc-active">active ${p.latest_year}</small><br><small>${esc((p.papers[0] || {}).title || "")}</small></span></label>`).join("")}</div>
      <button type="button" class="draft-btn" id="gs-draft">Draft emails for these <span id="gs-n">${cap}</span></button>
      <span id="gs-dmsg" class="acct-msg"></span>`;
    const boxes = [...out.querySelectorAll(".gs-pick input")];
    const sync = () => {
      let n = boxes.filter((b) => b.checked).length;
      const lim = maxDrafts();
      if (n > lim) { // enforce credit cap: uncheck the last ones the user ticked past the limit
        boxes.filter((b) => b.checked).slice(lim).forEach((b) => (b.checked = false));
        n = lim; $("#gs-dmsg").textContent = `Your credits cover ${lim} email${lim === 1 ? "" : "s"}.`;
      } else { $("#gs-dmsg").textContent = ""; }
      $("#gs-n").textContent = n; $("#gs-draft").disabled = n === 0;
    };
    boxes.forEach((b) => (b.onchange = sync)); sync();
    $("#gs-draft").onclick = () => gsDraftStep(profs, boxes);
  }

  // Save the chosen professors and draft sequentially with a progress line, then open My list.
  async function gsDraftStep(profs, boxes) {
    const out = $("#gs-out"), btn = $("#gs-draft");
    const chosen = boxes.filter((b) => b.checked).map((b) => profs[+b.value]);
    if (!chosen.length) return;
    btn.disabled = true;
    out.insertAdjacentHTML("beforeend", `<div class="draft-loading" id="gs-prog"><span class="spinner"></span><span id="gs-prog-t">Saving your list\u2026</span></div>`);
    const prog = $("#gs-prog-t");
    for (const p of chosen) {
      if (!saved.has(p.name)) {
        const { data } = await sb.from("saved_professors").insert({ author_name: p.name, institution: p.institution || null, orcid: p.orcid || null, openalex_id: p.id || null }).select().single();
        if (data) saved.set(p.name, data);
      }
    }
    let done = 0, next = 0;
    prog.textContent = `Drafting ${chosen.length} emails\u2026`;
    // 3 at a time (credits are reserved atomically server-side, so parallel requests can't overspend).
    const worker = async () => {
      while (next < chosen.length) {
        const p = chosen[next++];
        try {
          const d = await callDraft({ action: "email", author_name: p.name, institution: p.institution || undefined, openalex_id: p.id || undefined });
          setCredits(d.credits_cents); drafts.set(p.name, d);
          const cur = saved.get(p.name);
          if (cur) { const u = await sb.from("saved_professors").update({ status: "drafted" }).eq("author_name", p.name).select().single(); if (u.data) saved.set(p.name, u.data); }
        } catch (e) { /* skip failed one, keep going */ }
        done++;
        prog.textContent = `Drafted ${done} of ${chosen.length}\u2026`;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    gsSkipped = true; // flow complete; don't show it again
    renderBar(); renderGetStarted();
    const list = $("#my-list"); list.hidden = false; renderList();
    list.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Profile: documents in, condensed profile out ----
  async function callDraft(payload) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(SUPABASE_URL + "/functions/v1/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({ error: "Server error" }));
    if (!r.ok) throw new Error(d.error || "Request failed");
    return d;
  }
  // Free warm-up call: the server fetches + caches this professor's recent papers (once per session).
  const warmed = new Set();
  async function prefetchPapers(btn) {
    if (!btn || !user || !hasProfile || warmed.has(btn.dataset.draft)) return;
    warmed.add(btn.dataset.draft);
    try {
      const { data: { session } } = await sb.auth.getSession();
      fetch(SUPABASE_URL + "/functions/v1/draft", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ action: "email", prefetch: true, author_name: btn.dataset.draft, institution: btn.dataset.inst || undefined, openalex_id: btn.dataset.oa || undefined }),
      }).catch(() => {});
    } catch { /* best effort */ }
  }
  // Email drafts stream: words show up as the model writes them (~1s), then the final checked draft
  // replaces the preview. Falls back to the normal JSON response if the server doesn't stream.
  async function streamDraft(payload, outFor) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(SUPABASE_URL + "/functions/v1/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token },
      body: JSON.stringify({ ...payload, stream: true }),
    });
    if (!/ndjson/.test(r.headers.get("content-type") || "")) {
      const d = await r.json().catch(() => ({ error: "Server error" }));
      if (!r.ok) throw new Error(d.error || "Request failed");
      return d;
    }
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "", text = "", pre = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.error) throw new Error(m.error);
        if (m.done) return m.done;
        if (m.rewriting) { const o = outFor(); if (o) o.insertAdjacentHTML("afterbegin", `<div class="draft-loading"><span class="spinner"></span>Polishing it\u2026</div>`); continue; }
        if (m.t) {
          text += m.t;
          const o = outFor();
          if (o && !pre) { o.innerHTML = `<pre class="draft-stream"></pre>`; pre = o.querySelector("pre"); }
          if (pre) pre.textContent = text.replace(/^SUBJECT:\s*/i, "Subject: ").replace(/\n?BODY:\s*/i, "\n\n");
        }
      }
    }
    throw new Error("The draft was cut off. You weren't charged; try again.");
  }

  // ---- Send from my Gmail (feature-flagged, incremental authorization) ----
  async function callGmail(payload) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error("Sign in first.");
    const r = await fetch(SUPABASE_URL + "/functions/v1/gmail", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({ error: "Server error" }));
    if (!r.ok) { const e = new Error(d.error || "Request failed"); e.data = d; e.status = r.status; throw e; }
    return d;
  }

  async function refreshGmailStatus() {
    if (!gmailEnabled() || !user) { gmailConn = null; return; }
    try { gmailConn = await callGmail({ action: "status" }); } catch { gmailConn = null; }
  }

  // First click runs the Google OAuth code flow (popup) to get an auth code, which the server
  // exchanges for a refresh token. We never ask for Gmail at sign-in, only here on demand.
  function connectGmail() {
    return new Promise((resolve, reject) => {
      if (!window.google || !google.accounts || !google.accounts.oauth2) {
        return reject(new Error("Google sign-in library didn't load. Check your connection and retry."));
      }
      const client = google.accounts.oauth2.initCodeClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GMAIL_SEND_SCOPE,
        ux_mode: "popup",
        access_type: "offline",
        prompt: "consent",
        callback: async (resp) => {
          if (resp.error || !resp.code) return reject(new Error(resp.error || "Gmail connection was cancelled."));
          try { gmailConn = await callGmail({ action: "connect", code: resp.code }); resolve(gmailConn); }
          catch (e) { reject(e); }
        },
      });
      client.requestCode();
    });
  }

  async function disconnectGmail() {
    try { await callGmail({ action: "disconnect" }); } catch { /* ignore */ }
    gmailConn = { connected: false };
    renderBar();
  }

  // Draft row "Send from Gmail": confirm To+Subject, connect if needed, then send server-side.
  async function sendFromGmail(name, out, subj, body, toIn) {
    const msg = out.querySelector(".d-send-msg");
    const btn = out.querySelector('[data-act="send"]');
    const to = (toIn.value || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { msg.className = "d-send-msg err"; msg.textContent = "Add the professor's email in the To field first."; toIn.focus(); return; }
    if (!confirm(`Send this email from your Gmail?\n\nTo: ${to}\nSubject: ${subj.value}`)) return;
    btn.disabled = true; msg.className = "d-send-msg"; msg.textContent = "";
    try {
      if (!gmailConn || !gmailConn.connected) { msg.textContent = "Connecting your Gmail\u2026"; await connectGmail(); }
      msg.textContent = "Sending\u2026";
      const d = await callGmail({ action: "send", author_name: name, subject: subj.value, body: body.value });
      toast(`Sent from ${d.gmail_address}`);
      const cur = saved.get(name);
      if (cur) cur.status = "sent";
      renderList(); // card moves to Sent
    } catch (e) {
      btn.disabled = false;
      // If the server says a connection is needed (e.g. token revoked), offer to reconnect next click.
      if (e.data && e.data.needs_connect) gmailConn = { connected: false };
      msg.className = "d-send-msg err"; msg.textContent = e.message;
    }
  }

  function toast(text) {
    let t = $("#sr-toast");
    if (!t) { t = document.createElement("div"); t.id = "sr-toast"; t.className = "sr-toast"; document.body.appendChild(t); }
    t.textContent = text; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3500);
  }

  async function pdfToText(file) {
    if (!window.pdfjsLib) {
      await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"; s.integrity = "sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e"; s.crossOrigin = "anonymous"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) out += (await (await pdf.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ") + "\n";
    return out.trim();
  }

  async function renderProfile() {
    const el = $("#my-profile");
    if (!user || el.hidden) return;
    const [{ data: docs }, { data: prof }] = await Promise.all([
      sb.from("user_docs").select("id,kind,title,content,created_at").order("created_at"),
      sb.from("profiles").select("profile_summary,profile_updated_at,plan").single(),
    ]);
    el.innerHTML = `<h4>My profile</h4>
      <p class="hint">Add your resume, past projects and a short bio. We turn them into a profile and use it to draft short, specific emails to professors you saved. Nothing is sent for you; you copy the draft into your own email.</p>
      <ul class="docs">${(docs || []).map((d) => `<li><b>${esc(d.kind)}</b> ${esc(d.title || "")} <small>(${d.content.length.toLocaleString()} chars)</small> <button class="link-btn" data-deldoc="${d.id}">delete</button></li>`).join("") || "<li><i>No documents yet.</i></li>"}</ul>
      <form id="doc-form" class="doc-form">
        <select id="doc-kind"><option value="resume">Resume</option><option value="bio">Bio</option><option value="experience">Past work / project</option><option value="other">Other</option></select>
        <input id="doc-title" placeholder="Title (optional)" maxlength="200">
        <input id="doc-file" type="file" accept=".pdf,.txt,.md" multiple> <small>up to ${MAX_UPLOAD_MB} MB total</small>
        <textarea id="doc-text" rows="4" placeholder="...or paste text here" maxlength="60000"></textarea>
        <button type="submit">Add document</button> <span id="doc-msg" class="acct-msg"></span>
      </form>
      <div class="profile-sum"><b>Profile used for drafts</b>${prof && prof.profile_summary ? ` <small>(updated ${new Date(prof.profile_updated_at).toLocaleDateString()})</small><pre>${esc(prof.profile_summary)}</pre>` : "<p><i>Not built yet.</i></p>"}
        <button id="build-profile" ${docs && docs.length ? "" : "disabled"}>${prof && prof.profile_summary ? "Rebuild profile" : "Build profile"} ($0.10)</button> <span id="build-msg" class="acct-msg"></span></div>
      <details class="acct-danger"><summary>Your data</summary>
        <p class="hint">Download everything we store about you, or delete your account. Deleting cancels any plan, removes your profile, documents, saved professors and drafts, and can't be undone.</p>
        <button id="export-btn">Download my data</button>
        <span class="del-row"><input id="del-confirm" placeholder='type DELETE' maxlength="6" aria-label="Type DELETE to confirm"> <button id="delete-btn" class="danger-btn">Delete my account</button></span>
        <span id="data-msg" class="acct-msg"></span>
      </details>`;
    const callAccount = async (body) => {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(SUPABASE_URL + "/functions/v1/account", { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({ error: "Server error" }));
      if (!r.ok) throw new Error(d.error || "Request failed");
      return d;
    };
    $("#export-btn").onclick = async () => {
      $("#data-msg").textContent = "Preparing...";
      try {
        const d = await callAccount({ action: "export" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" })), download: "needalab-my-data.json" });
        a.click(); URL.revokeObjectURL(a.href); $("#data-msg").textContent = "Downloaded.";
      } catch (e) { $("#data-msg").textContent = e.message; }
    };
    $("#delete-btn").onclick = async () => {
      if ($("#del-confirm").value !== "DELETE") { $("#data-msg").textContent = "Type DELETE in the box first."; $("#del-confirm").focus(); return; }
      $("#delete-btn").disabled = true; $("#data-msg").textContent = "Deleting...";
      try { await callAccount({ action: "delete", confirm: "DELETE" }); await sb.auth.signOut(); location.href = "/?deleted=1"; }
      catch (e) { $("#delete-btn").disabled = false; $("#data-msg").textContent = e.message; }
    };
    el.querySelectorAll("[data-deldoc]").forEach((b) => (b.onclick = async () => { await sb.from("user_docs").delete().eq("id", b.dataset.deldoc); renderProfile(); }));
    $("#doc-form").onsubmit = async (ev) => {
      ev.preventDefault();
      const msg = $("#doc-msg");
      try {
        msg.textContent = "Reading...";
        const { text, names } = await readFiles($("#doc-file"), $("#doc-text").value.trim());
        if (!text) { msg.textContent = "Choose a file or paste text."; return; }
        const { error } = await sb.from("user_docs").insert({ kind: $("#doc-kind").value, title: $("#doc-title").value.trim() || names.join(", ").slice(0, 200) || null, content: text });
        if (error) throw error;
        renderProfile();
      } catch (e) { msg.textContent = "Error: " + e.message; }
    };
    $("#build-profile").onclick = async () => {
      $("#build-msg").textContent = "Building...";
      try { const d = await callDraft({ action: "profile" }); setCredits(d.credits_cents); hasProfile = true; renderProfile(); }
      catch (e) { $("#build-msg").textContent = e.message; }
    };
  }
  function toggleProfile() { const el = $("#my-profile"); el.hidden = !el.hidden; renderProfile(); }
  // Drafts are only as good as the profile, so send people there first instead of failing.
  function requireProfile() {
    $("#prof-panel") && $("#prof-panel").classList.remove("open");
    const el = $("#my-profile"); el.hidden = false;
    renderProfile().then(() => {
      el.insertAdjacentHTML("afterbegin", `<div class="notice"><b>First, set up your profile.</b> Add your resume, research or projects, then click <b>Build profile</b>. Every email is written from it, so it only mentions things you've actually done.</div>`);
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  // From the professor panel: put them on the list, open it, and draft in their row.
  async function draftFromPanel(btn) {
    if (!user) return signinPrompt("Sign in to draft emails.");
    if (!ageOk()) return;
    if (!hasProfile) return requireProfile();
    const name = btn.dataset.name;
    if (!saved.has(name)) { await toggle(btn); if (!saved.has(name)) return; }
    $("#prof-panel").classList.remove("open");
    openRows.add(name); // expanded, so the draft progress is visible
    const list = $("#my-list"); list.hidden = false; renderList();
    const row = list.querySelector(`[data-row="${CSS.escape(name)}"]`);
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    draftEmail(row.querySelector(".oc-head .draft-btn"));
  }
  function signinPrompt(msg) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("#signin-email") && $("#signin-email").focus();
    $("#signin-msg") && ($("#signin-msg").textContent = msg);
  }
  // Inline nudge right under the panel's action buttons when a signed-out user clicks Draft / Add.
  function showPanelNudge(panel) {
    const n = panel.querySelector(".pp-nudge");
    if (!n) return;
    n.hidden = false;
    n.innerHTML = `Sign in (free, $1 credit) to save and draft. <a href="#" class="pp-nudge-signin">Sign in</a>`;
    n.querySelector(".pp-nudge-signin").onclick = (e) => {
      e.preventDefault();
      panel.classList.remove("open");
      signinPrompt("Sign in to save and draft emails.");
    };
  }

  async function draftEmail(btn, force) {
    const name = btn.dataset.draft;
    const outFor = () => document.querySelector(`.draft-out[data-for="${CSS.escape(name)}"]`);
    if (!hasProfile) return requireProfile();
    outFor().innerHTML = `<div class="draft-loading"><span class="spinner"></span>Reading ${esc(name.split(" ").pop())}'s recent papers and writing your email\u2026</div>`;
    btn.disabled = true;
    try {
      const d = await streamDraft({ action: "email", author_name: name, institution: btn.dataset.inst || undefined, openalex_id: btn.dataset.oa || undefined, force: force || undefined }, outFor);
      if (d && d.mismatch) {
        btn.disabled = false;
        const titles = (d.papers || []).slice(0, 2).map((t) => `"${esc(t)}"`).join(", ");
        const o = outFor();
        o.innerHTML = `<div class="notice">This lab's recent work doesn't look related to your profile${titles ? ` (their papers: ${titles})` : ""}. Draft anyway? $0.25
          <div class="mismatch-actions"><button type="button" class="draft-btn" data-mm="anyway">Draft anyway</button> <button type="button" class="link-btn" data-mm="skip">Skip</button></div></div>`;
        o.querySelector('[data-mm="anyway"]').onclick = () => draftEmail(btn, true);
        o.querySelector('[data-mm="skip"]').onclick = () => { o.innerHTML = ""; };
        return;
      }
      setCredits(d.credits_cents);
      drafts.set(name, d);
      // Marking it drafted re-renders the list (which re-shows saved drafts), else render it here.
      const cur = saved.get(name);
      if (cur && (cur.status || "saved") === "saved") await updateRow(name, { status: "drafted" });
      else renderList();
    } catch (e) { btn.disabled = false; outFor().innerHTML = `<div class="draft-err">${esc(e.message)}</div>`; }
  }
  async function copy(text, el) { await navigator.clipboard.writeText(text); const t = el.textContent; el.textContent = "Copied \u2713"; setTimeout(() => (el.textContent = t), 1400); }

  // Free, automatic email finder (ORCID / papers / faculty page / shared records).
  // verified -> fill + save with status 'verified'. maybe/guess -> suggest only, never auto-saved.
  async function findEmail(btn) {
    const name = btn.dataset.find;
    const card = btn.closest("[data-row]");
    const input = card.querySelector('input[data-field="contact_email"]');
    const tag = card.querySelector(`[data-emailtag="${CSS.escape(name)}"]`);
    if (btn.dataset.busy) return; // it's a link now, so `disabled` doesn't stop double clicks
    btn.dataset.busy = "1"; btn.innerHTML = `<span class="spinner"></span> Searching\u2026`;
    tag.textContent = "";
    try {
      const d = await callFindEmail({ author_name: name, institution: btn.dataset.inst || undefined, openalex_id: btn.dataset.oa || undefined, orcid: btn.dataset.orcid || undefined });
      const verified = d.email && d.status !== "maybe" && d.confidence !== "low" && d.source !== "guessed";
      if (verified) {
        input.value = d.email;
        await updateRow(name, { contact_email: d.email, contact_email_status: "verified" });
        tag.className = "email-tag conf-high";
        const via = d.served_from === "shared" ? "shared" : (d.source || "found");
        tag.innerHTML = `verified \u00b7 ${esc(via)} ${bouncedLink(name)}`;
        wireBounced(tag, name);
      } else if (d.email) {
        // Best guess: a suggestion, never saved silently (a wrong address burns the student's shot).
        tag.className = "email-tag conf-low";
        tag.innerHTML = `Maybe: <b>${esc(d.email)}</b> (best guess) <button type="button" class="link-btn" data-useguess>Use anyway</button>`
          + (d.page_url ? ` \u00b7 <a href="${esc(d.page_url)}" target="_blank" rel="noopener">check their page</a>` : "");
        tag.querySelector("[data-useguess]").onclick = async () => { input.value = d.email; await updateRow(name, { contact_email: d.email, contact_email_status: "maybe" }); tag.innerHTML = `Maybe: <b>${esc(d.email)}</b> (best guess, saved) ${bouncedLink(name)}`; wireBounced(tag, name); };
      } else {
        tag.className = "email-tag conf-none";
        tag.innerHTML = d.page_url
          ? `No email found. <a href="${esc(d.page_url)}" target="_blank" rel="noopener">Open their page</a>`
          : "No email found \u2013 check their faculty page.";
      }
    } catch (e) {
      tag.className = "email-tag conf-none"; tag.textContent = e.message;
    } finally {
      delete btn.dataset.busy; btn.textContent = "Re-find";
    }
  }
  // POST to find-email with the signed-in session. Shared across find / confirm / bounce.
  async function callFindEmail(body) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(SUPABASE_URL + "/functions/v1/find-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({ error: "Server error" }));
    if (!r.ok) throw new Error(d.error || "Request failed");
    return d;
  }
  const bouncedLink = (name) => `\u00b7 <a href="#" class="link-btn" data-bounced="${esc(name)}">Bounced?</a>`;
  // "Bounced?" tells the shared record this address failed (one bounce per user), clears the saved
  // email, and re-runs the finder so the next-best source is tried.
  function wireBounced(tag, name) {
    const a = tag.querySelector(`[data-bounced="${CSS.escape(name)}"]`);
    if (!a) return;
    a.onclick = async (e) => {
      e.preventDefault();
      const row = saved.get(name) || {};
      const email = row.contact_email;
      if (!email) return;
      await callFindEmail({ action: "bounce", author_name: name, institution: row.institution || undefined, openalex_id: row.openalex_id || undefined, email }).catch(() => {});
      await updateRow(name, { contact_email: null, contact_email_status: null });
      const card = tag.closest("[data-row]");
      const input = card && card.querySelector('input[data-field="contact_email"]');
      if (input) input.value = "";
      const btn = card && card.querySelector(`[data-find="${CSS.escape(name)}"]`);
      if (btn) findEmail(btn);
    };
  }

  async function load() {
    saved = new Map(); drafts = new Map();
    if (user) {
      await refreshCredits();
      const [{ data, error }, { data: ds }] = await Promise.all([
        sb.from("saved_professors").select("*"),
        sb.from("drafts").select("author_name,subject,body,created_at").order("created_at"),
      ]);
      if (error) console.error(error); else data.forEach((r) => saved.set(r.author_name, r));
      (ds || []).forEach((d) => drafts.set(d.author_name, d)); // newest wins
      if (gmailEnabled()) refreshGmailStatus().then(renderBar); // async; bar updates when it lands
    }
    renderBar(); renderList(); paintStars(); renderGetStarted();
  }

  async function remove(name) {
    const { error } = await sb.from("saved_professors").delete().eq("author_name", name);
    if (error) return alert("Could not remove: " + error.message);
    saved.delete(name); renderBar(); renderList(); paintStars();
  }

  async function toggle(btn) {
    if (!user) return signinPrompt("Sign in to save professors.");
    if (!ageOk()) { $("#age-year") && $("#age-year").focus(); return; }
    const name = btn.dataset.name;
    if (saved.has(name)) return remove(name);
    if (btn.dataset.busy) return;
    // Instant feedback: fill the star now, roll back if the insert fails.
    btn.dataset.busy = "1"; btn.classList.add("on");
    btn.textContent = btn.classList.contains("pp-save") ? "\u2605 Saving\u2026" : "\u2605";
    const oa = btn.dataset.oa || await resolveOA(name, btn.dataset.orcid, btn.dataset.inst);
    const row = { author_name: name, institution: btn.dataset.inst || null, orcid: btn.dataset.orcid || null, openalex_id: oa || null };
    const { data, error } = await sb.from("saved_professors").insert(row).select().single();
    delete btn.dataset.busy;
    if (error) { paintStars(); return alert("Could not save: " + error.message); }
    saved.set(name, data); renderBar(); renderList(); paintStars();
  }

  // ---- Find professors by research interest (free) ----
  // Stopwords + a short checker so punctuation-only or filler-only queries don't hit the server.
  const FIND_STOP = new Set(["the","a","an","and","or","of","for","to","in","on","with","my","i","want","research","lab","labs","professor","professors","study","studying","about","how","what","is","are","this","that","please","help","find","looking","interested","science","stem"]);
  const EXAMPLE_TOPICS = ["soft robotics", "EEG brain-computer interfaces", "CRISPR gene editing", "perovskite solar cells"];
  function contentWords(q) {
    return (q.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g) || []).filter((w) => !FIND_STOP.has(w));
  }
  async function runFind(ev) {
    ev.preventDefault();
    const q = $("#find-q").value.trim(), out = $("#find-out");
    if (q.length < 3) {
      out.innerHTML = `<p class="hint">Type a research topic, e.g. soft robotics.</p>`;
      $("#find-q") && $("#find-q").focus();
      return;
    }
    if (!contentWords(q).length) {
      out.innerHTML = `<p class="hint">Type a research topic, e.g. soft robotics.</p>`;
      $("#find-q") && $("#find-q").focus();
      return;
    }
    const go = $("#find-form button[type=submit]");
    if (go) { go.disabled = true; go.dataset.label ??= go.textContent; go.innerHTML = `<span class="spinner"></span> Finding`; }
    out.innerHTML = `<div class="draft-loading"><span class="spinner"></span>Searching recent papers\u2026</div>`;
    try { await runFindInner(q, out); } finally { if (go) { go.disabled = false; go.textContent = go.dataset.label; } }
  }
  async function runFindInner(q, out) {
    try {
      const { data: { session } } = await sb.auth.getSession();
      const headers = { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY };
      if (session) headers.Authorization = "Bearer " + session.access_token; // signed-in users get a higher daily search limit
      const r = await fetch(SUPABASE_URL + "/functions/v1/find", {
        method: "POST", headers,
        body: JSON.stringify({ query: q, country: $("#find-country").value || undefined, years: 3 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Search failed");
      if (!d.professors.length) {
        out.innerHTML = `<p>No active labs found. Check the spelling, or try the technique instead of the application:</p>
          <p class="find-examples">${EXAMPLE_TOPICS.map((t) => `<button type="button" data-ex="${esc(t)}">${esc(t)}</button>`).join("")}</p>`;
        out.querySelectorAll(".find-examples button").forEach((b) => (b.onclick = () => {
          $("#find-q").value = b.dataset.ex;
          runFind({ preventDefault() {} });
        }));
        return;
      }
      const card = (p) => `<div class="prof-card">
          <div class="pc-head"><button class="save-star" data-name="${esc(p.name)}" data-inst="${esc(p.institution || "")}" data-orcid="${esc(p.orcid || "")}" data-oa="${esc(p.id)}" title="Save">\u2606</button>
            <b><a href="#" class="prof-open" data-oa="${esc(p.id)}">${esc(p.name)}</a></b>
            <span class="pc-inst">${esc(p.institution || "")}</span> <span class="pc-active">active ${p.latest_year}</span>${badges(p)}</div>
          <ul>${p.papers.map((x) => `<li>${x.doi ? `<a target="_blank" rel="noopener" href="${esc(x.doi)}">${esc(x.title)}</a>` : esc(x.title)} <small>(${x.year}${x.venue ? ", " + esc(x.venue) : ""})</small></li>`).join("")}</ul></div>`;
      const PAGE = 25;
      let shown = 0;
      const total = d.total_papers ?? d.matched_papers;
      const weak = d.professors.length < 8 ? `<p class="find-weak">Only a few matches. These may be loosely related; try a broader or more technical term.</p>` : "";
      out.innerHTML = `${weak}<p class="hint">${d.professors.length} labs leading recent work on <b>${esc(d.query)}</b>, from the ${d.matched_papers.toLocaleString()} most relevant of ${total.toLocaleString()} papers in the last ${d.years} years. Ranked by how much recent, relevant work they lead.</p>
        <div class="find-cards"></div><button type="button" class="find-more draft-btn" hidden></button>`;
      const cards = out.querySelector(".find-cards"), moreBtn = out.querySelector(".find-more");
      const showMore = () => {
        const next = d.professors.slice(shown, shown + PAGE);
        cards.insertAdjacentHTML("beforeend", next.map(card).join(""));
        shown += next.length;
        const left = d.professors.length - shown;
        moreBtn.hidden = left <= 0;
        moreBtn.textContent = `Show ${Math.min(PAGE, left)} more (${left} left)`;
        cards.querySelectorAll(".save-star:not([data-wired])").forEach((b) => { b.dataset.wired = 1; b.onclick = () => toggle(b); });
        cards.querySelectorAll(".prof-open:not([data-wired])").forEach((a) => { a.dataset.wired = 1; a.onclick = (e) => { e.preventDefault(); openProfessor(a.dataset.oa); }; });
        paintStars();
      };
      moreBtn.onclick = showMore;
      showMore();
    } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  window.srFind = runFind;

  // ---- Professor page (slide-over panel), free ----
  // Panel data is cached per id and fetched on hover, so most clicks render instantly.
  const profData = new Map();
  function loadProfessor(oaId) {
    if (!profData.has(oaId)) {
      const p = fetch(SUPABASE_URL + "/functions/v1/professor", { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY }, body: JSON.stringify({ id: oaId }) })
        .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not load"); return d; });
      p.catch(() => profData.delete(oaId));
      profData.set(oaId, p);
    }
    return profData.get(oaId);
  }
  document.addEventListener("pointerover", (e) => {
    const a = e.target.closest && e.target.closest(".prof-open[data-oa]");
    if (a && a.dataset.oa) loadProfessor(a.dataset.oa).catch(() => {});
  });
  async function openProfessor(oaId) {
    let panel = $("#prof-panel");
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "prof-panel"; panel.className = "prof-panel"; panel.setAttribute("role", "dialog");
      document.body.appendChild(panel);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") panel.classList.remove("open"); });
    }
    panel.innerHTML = '<button class="pp-close" aria-label="Close">\u2715</button><p>Loading...</p>';
    panel.classList.add("open");
    panel.querySelector(".pp-close").onclick = () => panel.classList.remove("open");
    try {
      const p = await loadProfessor(oaId);
      const role = { senior: "senior author", first: "first author", middle: "co-author" };
      panel.innerHTML = `<button class="pp-close" aria-label="Close">\u2715</button>
        <h3>${esc(p.name)}</h3>
        <div class="pp-inst" title="${esc(p.institutions.join(" \u00b7 "))}">${esc(p.institutions.slice(0, 2).join(" \u00b7 ") || "Institution unknown")}${p.institutions.length > 2 ? ` <small>+${p.institutions.length - 2} more</small>` : ""}</div>
        <div class="pp-actions">
          <button class="save-star pp-save" data-name="${esc(p.name)}" data-inst="${esc(p.institutions[0] || "")}" data-orcid="${esc(p.orcid || "")}" data-oa="${esc(p.id)}">\u2606 Add to my list</button>
          <button class="pp-draft" data-name="${esc(p.name)}" data-inst="${esc(p.institutions[0] || "")}" data-orcid="${esc(p.orcid || "")}" data-oa="${esc(p.id)}">\u2709 Draft email \u00b7 $0.25</button>
        </div>
        <div class="pp-nudge" hidden></div>
        <div class="pp-stats"><span><b>${p.papers_last_2y}</b> papers in 2 yrs</span><span>h-index <b>${p.h_index ?? "?"}</b></span>
          ${p.leads_lab ? '<span class="pc-active">leads recent work</span>' : '<span class="pp-warn">few recent senior-author papers</span>'}${badges(p)}</div>
        ${p.topics.length ? `<div class="pp-topics">${p.topics.map((t) => `<span class="pill">${esc(t)}</span>`).join("")}</div>` : ""}
        <h4>Recent papers</h4><ul class="pp-papers">${p.papers.map((x) => `<li>${x.doi ? `<a target="_blank" rel="noopener" href="${esc(x.doi)}">${esc(x.title)}</a>` : esc(x.title)}
          <small>${x.year}${x.venue ? " \u00b7 " + esc(x.venue) : ""} \u00b7 ${role[x.role]}</small></li>`).join("")}</ul>
        ${p.collaborators.length ? `<h4>Works often with</h4><ul class="pp-collab">${p.collaborators.map((c) => `<li><a href="#" class="prof-open" data-oa="${esc(c.id)}">${esc(c.name)}</a> <small>${esc(c.institution || "")} \u00b7 ${c.n} papers</small></li>`).join("")}</ul>` : ""}
        <p class="pp-links">${p.orcid ? `<a target="_blank" rel="noopener" href="https://orcid.org/${esc(p.orcid)}">ORCID</a> \u00b7 ` : ""}<a target="_blank" rel="noopener" href="https://openalex.org/authors/${esc(p.id)}">All papers on OpenAlex</a> \u00b7
          <a target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(p.name + " " + (p.institutions[0] || "") + " email")}">Find their faculty page</a></p>`;
      panel.querySelector(".pp-close").onclick = () => panel.classList.remove("open");
      panel.querySelector(".save-star").onclick = (e) => { if (!user) return showPanelNudge(panel); toggle(e.currentTarget); };
      panel.querySelector(".pp-draft").onclick = (e) => { if (!user) return showPanelNudge(panel); draftFromPanel(e.currentTarget); };
      panel.querySelectorAll(".prof-open").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openProfessor(a.dataset.oa); }));
      paintStars();
    } catch (e) { panel.innerHTML = `<button class="pp-close" aria-label="Close">\u2715</button><p class="err">${esc(e.message)}</p>`; panel.querySelector(".pp-close").onclick = () => panel.classList.remove("open"); }
  }
  // Rankings rows only carry name/ORCID/institution; resolve the OpenAlex author id in the browser
  // (ORCID singleton lookup, else a name search) so they can open the same panel as the finder.
  const oaIds = new Map();
  async function resolveOA(name, orcid, inst) {
    const k = orcid || name;
    if (oaIds.has(k)) return oaIds.get(k);
    const short = (u) => (u || "").split("/").pop() || null;
    let id = null;
    try {
      if (orcid && orcid !== "0000-0000-0000-0000") {
        const r = await fetch(`https://api.openalex.org/authors/orcid:${encodeURIComponent(orcid)}?select=id&mailto=stemrankings@kahlus.com`);
        if (r.ok) id = short((await r.json()).id);
      }
      if (!id) {
        const r = await fetch(`https://api.openalex.org/authors?search=${encodeURIComponent(name)}&select=id,last_known_institutions&per-page=10&mailto=stemrankings@kahlus.com`);
        const res = r.ok ? (await r.json()).results : [];
        const hit = res.find((a) => (a.last_known_institutions || []).some((i) => i.display_name === inst)) || res[0];
        id = hit ? short(hit.id) : null;
      }
    } catch { /* network: fall through */ }
    if (id) oaIds.set(k, id);
    return id;
  }
  async function openProfessorByName(name, orcid, inst) {
    const id = await resolveOA(name, orcid, inst);
    if (id) return openProfessor(id);
    window.open(`https://openalex.org/works?search=${encodeURIComponent(name)}`, "_blank", "noopener");
  }
  window.srOpenProfessor = openProfessor;
  window.srOpenProfessorByName = openProfessorByName;
  // Rankings faculty rows are re-rendered often, so delegate from document.
  document.addEventListener("click", (e) => {
    const row = e.target.closest("tr.faculty-row");
    if (!row || e.target.closest("button, a:not(.fac-open)")) return;
    e.preventDefault();
    openProfessorByName(row.dataset.name, row.dataset.orcid, row.dataset.inst);
  });
  document.addEventListener("pointerover", (e) => {
    const row = e.target.closest && e.target.closest("tr.faculty-row");
    if (!row || row.dataset.warm) return;
    row.dataset.warm = 1;
    resolveOA(row.dataset.name, row.dataset.orcid, row.dataset.inst).then((id) => id && loadProfessor(id).catch(() => {}));
  });
  // Deep link from topic pages: /?q=<topic>&prof=<openalex_id> prefills the finder,
  // runs it, and (if prof= given) opens that professor's slide-over panel.
  const dlQuery = (new URLSearchParams(location.search).get("q") || "").trim();
  async function runDeepLink() {
    const sp = new URLSearchParams(location.search);
    $("#find-q").value = dlQuery.slice(0, 200);
    await runFind({ preventDefault() {} });
    const prof = (sp.get("prof") || "").trim();
    if (prof) openProfessor(prof.split("/").pop());
  }

  // Run on arrival: a ?q= deep link, or a search the user submitted before this script loaded.
  if ($("#find-q") && dlQuery.length >= 3) runDeepLink();
  else if ($("#find-q") && $("#find-q").value.trim().length >= 3 && !$("#find-out").innerHTML) runFind({ preventDefault() {} });
  // Example topic links ("Try: soft robotics") search in place; without JS they still work as ?q= links.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-ex]");
    if (!a || !$("#find-q") || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    $("#find-q").value = a.dataset.ex;
    runFind({ preventDefault() {} });
    $("#find-out")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });

  // "Roast a feature" footer form. Works signed in or out; the server rate-limits it.
  if ($("#roast-form")) $("#roast-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const msg = $("#roast-msg"), btn = ev.target.querySelector("button");
    btn.disabled = true; msg.textContent = "Sending\u2026";
    try {
      const { data: { session } } = await sb.auth.getSession();
      const headers = { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY };
      if (session) headers.Authorization = "Bearer " + session.access_token;
      const r = await fetch(SUPABASE_URL + "/functions/v1/portal", { method: "POST", headers, body: JSON.stringify({ action: "feedback", feature: $("#roast-feature").value, roast: $("#roast-text").value, page: location.pathname + location.search }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't send. Try again.");
      ev.target.reset(); msg.textContent = "Got it. Thanks for the roast.";
    } catch (e) { msg.textContent = e.message; }
    btn.disabled = false;
  };

  sb.auth.onAuthStateChange((_event, session) => {
    const next = session ? session.user : null;
    if ((next && next.id) === (user && user.id)) return;
    user = next; load();
  });
  sb.auth.getSession().then(({ data }) => { user = data.session ? data.session.user : null; load(); });

  window.srAccount = { toggle, paintStars, _client: sb };
})();
