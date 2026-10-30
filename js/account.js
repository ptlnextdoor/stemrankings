/* STEMRankings accounts: email magic-link sign-in and a saved-professors list, backed by Supabase.
   The anon key below is public by design; Row Level Security in supabase/migrations restricts
   every user to their own rows, and profiles.plan cannot be changed from the browser. */
(function () {
  const SUPABASE_URL = "https://oxcnlommtnziwfbpxigd.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94Y25sb21tdG56aXdmYnB4aWdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NDkzNTcsImV4cCI6MjEwNzEyNTM1N30._6MDpHUC41GsvD6OQJsn3AXlJBAlVqkq__46QwE_JH8";
  if (!window.supabase) { console.error("supabase-js failed to load"); return; }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
    if (!user) {
      bar.innerHTML = `<form id="signin-form" class="signin">
        <input id="signin-email" type="email" required placeholder="you@school.edu" aria-label="Email">
        <button type="submit">Sign in / Sign up</button>
        <span id="signin-msg" class="acct-msg"></span></form>`;
      $("#signin-form").onsubmit = async (ev) => {
        ev.preventDefault();
        const email = $("#signin-email").value.trim();
        $("#signin-msg").textContent = "Sending...";
        const { error } = await sb.auth.signInWithOtp({
          email, options: { emailRedirectTo: location.origin + location.pathname },
        });
        $("#signin-msg").textContent = error ? "Error: " + error.message : "Check your email for a sign-in link.";
      };
    } else if (birthYear == null || !displayName) {
      // One-time onboarding: name signs the drafted emails, birth year is the COPPA gate.
      bar.innerHTML = `<form id="age-form" class="signin"><span>Welcome! Two quick things before you start:</span>
        ${displayName ? "" : `<input id="age-name" required maxlength="80" placeholder="Your full name" aria-label="Your full name">`}
        ${birthYear == null ? `<input id="age-year" type="number" min="1900" max="${new Date().getFullYear()}" required style="min-width:110px" placeholder="Birth year" aria-label="Birth year">` : ""}
        <button type="submit">Continue</button> <button type="button" id="age-signout">Sign out</button>
        <span id="age-msg" class="acct-msg"></span></form>`;
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
        renderBar(); renderList(); paintStars();
      };
    } else if (birthYear > new Date().getFullYear() - 13) {
      bar.innerHTML = `<span class="acct-msg">Sorry, you need to be 13 or older to use accounts on STEMRankings. You can still browse the rankings and search for professors.</span>
        <button id="signout-btn">Sign out</button>`;
      $("#signout-btn").onclick = () => sb.auth.signOut();
    } else {
      bar.innerHTML = `<span class="acct-who">Hi, <b>${esc(displayName.split(" ")[0])}</b></span>
        <span class="credits" id="credits" title="Profile build $0.10, email draft $0.25">${credits == null ? "" : "$" + (credits / 100).toFixed(2) + " credits"}</span>
        <button id="billing-btn">${plan === "pro" ? "Manage plan" : "Get $10/mo plan"}</button>
        <button id="mylist-btn">My list (${saved.size})</button>
        <button id="profile-btn">My profile</button>
        <button id="signout-btn">Sign out</button>
        <span id="billing-msg" class="acct-msg"></span>`;
      $("#signout-btn").onclick = () => sb.auth.signOut();
      $("#mylist-btn").onclick = toggleList;
      $("#profile-btn").onclick = toggleProfile;
      $("#billing-btn").onclick = async () => {
        $("#billing-msg").textContent = "Opening checkout...";
        try {
          const { data: { session } } = await sb.auth.getSession();
          const r = await fetch(SUPABASE_URL + "/functions/v1/billing", { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ action: plan === "pro" ? "portal" : "checkout" }) });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          location.href = d.url;
        } catch (e) { $("#billing-msg").textContent = e.message; }
      };
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
    el.innerHTML = `<div class="ol-head"><h4>My outreach <span class="ol-count">${rows.length}</span></h4>
        ${hasProfile ? "" : `<button class="ol-cta" data-goprofile>Set up your profile first \u2192</button>`}</div>`
      + (rows.length ? `<div class="pipeline">${STATUSES.filter(([k]) => counts[k]).map(([k, l]) => `<span class="pill st-${k}">${l} <b>${counts[k]}</b></span>`).join("")}</div>` : "")
      + (due.length ? `<div class="due">\u23F0 Follow up today: ${due.map((r) => esc(r.author_name)).join(", ")}</div>` : "")
      + (rows.length
      ? `<div class="tracker">` + rows.map((r) => {
          const st = r.status || "saved", n = esc(r.author_name);
          return `<article class="oc st-b-${st}" data-row="${n}">
          <header class="oc-head">
            <div class="oc-who">${r.openalex_id ? `<a href="#" class="prof-open oc-name" data-oa="${esc(r.openalex_id)}">${n}</a>` : `<span class="oc-name">${n}</span>`}
              ${r.institution ? `<span class="oc-inst">${esc(r.institution)}</span>` : ""}</div>
            <span class="pill st-${st}">${stLabel[st]}</span>
          </header>
          <div class="oc-fields">
            <label>Status<select data-field="status">${STATUSES.map(([k, l]) => `<option value="${k}" ${st === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <label>Their email<input type="email" data-field="contact_email" placeholder="from their faculty page" value="${esc(r.contact_email || "")}" maxlength="254"></label>
            <label>Follow up on<input type="date" data-field="follow_up_on" value="${r.follow_up_on || ""}"></label>
          </div>
          <input class="note" data-field="note" data-for="${n}" placeholder="Notes: what they work on, what you asked" value="${esc(r.note || "")}" maxlength="2000">
          <div class="oc-actions">
            <button class="draft-btn" data-draft="${n}" data-inst="${esc(r.institution || "")}" data-oa="${esc(r.openalex_id || "")}">\u2709 ${drafts.has(r.author_name) ? "Redraft" : "Draft email"} <small>$0.25</small></button>
            <button class="link-btn" data-remove="${n}">Remove</button>
          </div>
          <div class="draft-out" data-for="${n}"></div>
        </article>`;
        }).join("") + `</div>`
      : `<div class="ol-empty"><b>Your list is empty.</b> Search for a topic below, or click \u2606 next to any professor, to start your list.</div>`);
    el.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = () => remove(b.dataset.remove)));
    el.querySelectorAll("[data-draft]").forEach((b) => (b.onclick = () => draftEmail(b)));
    el.querySelectorAll("[data-goprofile]").forEach((b) => (b.onclick = requireProfile));
    el.querySelectorAll(".prof-open").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openProfessor(a.dataset.oa); }));
    el.querySelectorAll("[data-field]").forEach((inp) => (inp.onchange = () => {
      const name = inp.dataset.for || inp.closest("[data-row]").dataset.row;
      updateRow(name, { [inp.dataset.field]: inp.value || null });
    }));
    for (const [name, d] of drafts) { const out = el.querySelector(`.draft-out[data-for="${CSS.escape(name)}"]`); if (out) showDraft(out, name, d); }
  }

  // Email-client style preview: editable, copyable, opens straight in Gmail or the default mail app.
  function showDraft(out, name, d) {
    const row = saved.get(name) || {};
    const to = row.contact_email || "";
    out.innerHTML = `<div class="draft">
      <div class="draft-meta"><span>To</span><input class="d-to" type="email" value="${esc(to)}" placeholder="paste their email from the faculty page"></div>
      <div class="draft-meta"><span>Subject</span><input class="d-subj-in" value="${esc(d.subject)}"></div>
      <span class="d-subj" hidden>${esc(d.subject)}</span>
      <textarea class="d-body-in" rows="12">${esc(d.body)}</textarea>
      <pre class="d-body" hidden>${esc(d.body)}</pre>
      <div class="draft-bar">
        <button class="btn-primary" data-act="copy">Copy email</button>
        <a class="btn" data-act="gmail" target="_blank" rel="noopener">Open in Gmail</a>
        <a class="btn" data-act="mail">Mail app</a>
        <button class="btn" data-act="sent">Mark as sent</button>
        <span class="draft-wc"></span>
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
    out.querySelector('[data-act="sent"]').onclick = () => updateRow(name, { status: "sent" });
    sync();
  }

  async function updateRow(name, patch) {
    if (patch.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(patch.contact_email)) return alert("That email address doesn't look right.");
    const { data, error } = await sb.from("saved_professors").update(patch).eq("author_name", name).select().single();
    if (error) return alert("Could not save: " + error.message);
    saved.set(name, data);
    if ("status" in patch) renderList(); // status change can set sent_at / follow-up date server-side
  }

  function toggleList() { const el = $("#my-list"); el.hidden = !el.hidden; renderList(); }

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

  async function pdfToText(file) {
    if (!window.pdfjsLib) {
      await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
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
        <input id="doc-file" type="file" accept=".pdf,.txt,.md">
        <textarea id="doc-text" rows="4" placeholder="...or paste text here" maxlength="60000"></textarea>
        <button type="submit">Add document</button> <span id="doc-msg" class="acct-msg"></span>
      </form>
      <div class="profile-sum"><b>Profile used for drafts</b>${prof && prof.profile_summary ? ` <small>(updated ${new Date(prof.profile_updated_at).toLocaleDateString()})</small><pre>${esc(prof.profile_summary)}</pre>` : "<p><i>Not built yet.</i></p>"}
        <button id="build-profile" ${docs && docs.length ? "" : "disabled"}>${prof && prof.profile_summary ? "Rebuild profile" : "Build profile"} ($0.10)</button> <span id="build-msg" class="acct-msg"></span></div>`;
    el.querySelectorAll("[data-deldoc]").forEach((b) => (b.onclick = async () => { await sb.from("user_docs").delete().eq("id", b.dataset.deldoc); renderProfile(); }));
    $("#doc-form").onsubmit = async (ev) => {
      ev.preventDefault();
      const msg = $("#doc-msg"), f = $("#doc-file").files[0];
      let text = $("#doc-text").value.trim();
      try {
        if (f) { msg.textContent = "Reading file..."; text = f.name.toLowerCase().endsWith(".pdf") ? await pdfToText(f) : await f.text(); }
        if (!text) { msg.textContent = "Choose a file or paste text."; return; }
        const { error } = await sb.from("user_docs").insert({ kind: $("#doc-kind").value, title: $("#doc-title").value.trim() || (f ? f.name : null), content: text.slice(0, 60000) });
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
    const list = $("#my-list"); list.hidden = false; renderList();
    const row = list.querySelector(`[data-row="${CSS.escape(name)}"]`);
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    draftEmail(row.querySelector(".draft-btn"));
  }
  function signinPrompt(msg) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("#signin-email") && $("#signin-email").focus();
    $("#signin-msg") && ($("#signin-msg").textContent = msg);
  }

  async function draftEmail(btn) {
    const name = btn.dataset.draft;
    const outFor = () => document.querySelector(`.draft-out[data-for="${CSS.escape(name)}"]`);
    if (!hasProfile) return requireProfile();
    outFor().innerHTML = `<div class="draft-loading"><span class="spinner"></span>Reading ${esc(name.split(" ").pop())}'s recent papers and writing your email\u2026</div>`;
    btn.disabled = true;
    try {
      const d = await callDraft({ action: "email", author_name: name, institution: btn.dataset.inst || undefined, openalex_id: btn.dataset.oa || undefined });
      setCredits(d.credits_cents);
      drafts.set(name, d);
      // Marking it drafted re-renders the list (which re-shows saved drafts), else render it here.
      const cur = saved.get(name);
      if (cur && (cur.status || "saved") === "saved") await updateRow(name, { status: "drafted" });
      else renderList();
    } catch (e) { btn.disabled = false; outFor().innerHTML = `<div class="draft-err">${esc(e.message)}</div>`; }
  }
  async function copy(text, el) { await navigator.clipboard.writeText(text); const t = el.textContent; el.textContent = "Copied \u2713"; setTimeout(() => (el.textContent = t), 1400); }

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
    }
    renderBar(); renderList(); paintStars();
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
    const oa = btn.dataset.oa || await resolveOA(name, btn.dataset.orcid, btn.dataset.inst);
    const row = { author_name: name, institution: btn.dataset.inst || null, orcid: btn.dataset.orcid || null, openalex_id: oa || null };
    const { data, error } = await sb.from("saved_professors").insert(row).select().single();
    if (error) return alert("Could not save: " + error.message);
    saved.set(name, data); renderBar(); renderList(); paintStars();
  }

  // ---- Find professors by research interest (free) ----
  async function runFind(ev) {
    ev.preventDefault();
    const q = $("#find-q").value.trim(), out = $("#find-out");
    if (q.length < 3) return;
    out.innerHTML = "<p><small>Searching recent papers...</small></p>";
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
      if (!d.professors.length) { out.innerHTML = "<p>No active labs found in the last few years. Try broader or different words (e.g. the technique instead of the application).</p>"; return; }
      const card = (p) => `<div class="prof-card">
          <div class="pc-head"><button class="save-star" data-name="${esc(p.name)}" data-inst="${esc(p.institution || "")}" data-orcid="${esc(p.orcid || "")}" data-oa="${esc(p.id)}" title="Save">\u2606</button>
            <b><a href="#" class="prof-open" data-oa="${esc(p.id)}">${esc(p.name)}</a></b>
            <span class="pc-inst">${esc(p.institution || "")}</span> <span class="pc-active">active ${p.latest_year}</span></div>
          <ul>${p.papers.map((x) => `<li>${x.doi ? `<a target="_blank" rel="noopener" href="${esc(x.doi)}">${esc(x.title)}</a>` : esc(x.title)} <small>(${x.year}${x.venue ? ", " + esc(x.venue) : ""})</small></li>`).join("")}</ul></div>`;
      const PAGE = 25;
      let shown = 0;
      const total = d.total_papers ?? d.matched_papers;
      out.innerHTML = `<p class="hint">${d.professors.length} labs leading recent work on <b>${esc(d.query)}</b>, from the ${d.matched_papers.toLocaleString()} most relevant of ${total.toLocaleString()} papers in the last ${d.years} years. Ranked by how much recent, relevant work they lead.</p>
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
      const r = await fetch(SUPABASE_URL + "/functions/v1/professor", { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY }, body: JSON.stringify({ id: oaId }) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || "Could not load");
      const role = { senior: "senior author", first: "first author", middle: "co-author" };
      panel.innerHTML = `<button class="pp-close" aria-label="Close">\u2715</button>
        <h3>${esc(p.name)}</h3>
        <div class="pp-inst" title="${esc(p.institutions.join(" \u00b7 "))}">${esc(p.institutions.slice(0, 2).join(" \u00b7 ") || "Institution unknown")}${p.institutions.length > 2 ? ` <small>+${p.institutions.length - 2} more</small>` : ""}</div>
        <div class="pp-actions">
          <button class="save-star pp-save" data-name="${esc(p.name)}" data-inst="${esc(p.institutions[0] || "")}" data-orcid="${esc(p.orcid || "")}" data-oa="${esc(p.id)}">\u2606 Add to my list</button>
          <button class="pp-draft" data-name="${esc(p.name)}" data-inst="${esc(p.institutions[0] || "")}" data-orcid="${esc(p.orcid || "")}" data-oa="${esc(p.id)}">\u2709 Draft email \u00b7 $0.25</button>
        </div>
        <div class="pp-stats"><span><b>${p.papers_last_2y}</b> papers in 2 yrs</span><span>h-index <b>${p.h_index ?? "?"}</b></span>
          ${p.leads_lab ? '<span class="pc-active">leads recent work</span>' : '<span class="pp-warn">few recent senior-author papers</span>'}</div>
        ${p.topics.length ? `<div class="pp-topics">${p.topics.map((t) => `<span class="pill">${esc(t)}</span>`).join("")}</div>` : ""}
        <h4>Recent papers</h4><ul class="pp-papers">${p.papers.map((x) => `<li>${x.doi ? `<a target="_blank" rel="noopener" href="${esc(x.doi)}">${esc(x.title)}</a>` : esc(x.title)}
          <small>${x.year}${x.venue ? " \u00b7 " + esc(x.venue) : ""} \u00b7 ${role[x.role]}</small></li>`).join("")}</ul>
        ${p.collaborators.length ? `<h4>Works often with</h4><ul class="pp-collab">${p.collaborators.map((c) => `<li><a href="#" class="prof-open" data-oa="${esc(c.id)}">${esc(c.name)}</a> <small>${esc(c.institution || "")} \u00b7 ${c.n} papers</small></li>`).join("")}</ul>` : ""}
        <p class="pp-links">${p.orcid ? `<a target="_blank" rel="noopener" href="https://orcid.org/${esc(p.orcid)}">ORCID</a> \u00b7 ` : ""}<a target="_blank" rel="noopener" href="https://openalex.org/authors/${esc(p.id)}">All papers on OpenAlex</a> \u00b7
          <a target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(p.name + " " + (p.institutions[0] || "") + " email")}">Find their faculty page</a></p>`;
      panel.querySelector(".pp-close").onclick = () => panel.classList.remove("open");
      panel.querySelector(".save-star").onclick = (e) => toggle(e.currentTarget);
      panel.querySelector(".pp-draft").onclick = (e) => draftFromPanel(e.currentTarget);
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
  // If the user submitted before this script loaded, run their search now.
  if ($("#find-q") && $("#find-q").value.trim().length >= 3 && !$("#find-out").innerHTML) runFind({ preventDefault() {} });

  sb.auth.onAuthStateChange((_event, session) => {
    const next = session ? session.user : null;
    if ((next && next.id) === (user && user.id)) return;
    user = next; load();
  });
  sb.auth.getSession().then(({ data }) => { user = data.session ? data.session.user : null; load(); });

  window.srAccount = { toggle, paintStars, _client: sb };
})();
