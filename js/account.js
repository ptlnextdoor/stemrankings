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
  let credits = null, plan = "free", birthYear = undefined;
  const ageOk = () => typeof birthYear === "number" && birthYear <= new Date().getFullYear() - 13;
  async function refreshCredits() {
    if (!user) { credits = null; return; }
    const { data } = await sb.from("profiles").select("credits_cents,plan,birth_year").single();
    if (data) { credits = data.credits_cents; plan = data.plan; birthYear = data.birth_year; }
  }
  function setCredits(c) { if (typeof c === "number") { credits = c; const el = $("#credits"); if (el) el.textContent = "$" + (c / 100).toFixed(2) + " credits"; } }
  let saved = new Map(); // author_name -> row

  function paintStars() {
    document.querySelectorAll(".save-star").forEach((b) => {
      const on = saved.has(b.dataset.name);
      b.textContent = on ? "\u2605" : "\u2606";
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
    } else if (birthYear == null) {
      bar.innerHTML = `<form id="age-form" class="signin"><span>One quick question before you start. What year were you born?</span>
        <input id="age-year" type="number" min="1900" max="${new Date().getFullYear()}" required style="min-width:90px" aria-label="Birth year">
        <button type="submit">Continue</button> <button type="button" id="age-signout">Sign out</button>
        <span id="age-msg" class="acct-msg"></span></form>`;
      $("#age-signout").onclick = () => sb.auth.signOut();
      $("#age-form").onsubmit = async (ev) => {
        ev.preventDefault();
        const y = parseInt($("#age-year").value, 10);
        if (!(y >= 1900 && y <= new Date().getFullYear())) return ($("#age-msg").textContent = "Enter a 4-digit year.");
        const { error } = await sb.from("profiles").update({ birth_year: y }).eq("id", user.id);
        if (error) return ($("#age-msg").textContent = "Error: " + error.message);
        birthYear = y; renderBar(); renderList(); paintStars();
      };
    } else if (birthYear > new Date().getFullYear() - 13) {
      bar.innerHTML = `<span class="acct-msg">Sorry, you need to be 13 or older to use accounts on STEMRankings. You can still browse the rankings and search for professors.</span>
        <button id="signout-btn">Sign out</button>`;
      $("#signout-btn").onclick = () => sb.auth.signOut();
    } else {
      bar.innerHTML = `<span class="acct-who">Signed in as <b>${esc(user.email)}</b></span>
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
    el.innerHTML = `<h4>My outreach (${rows.length})</h4>`
      + (rows.length ? `<div class="pipeline">${STATUSES.filter(([k]) => counts[k]).map(([k, l]) => `<span class="pill st-${k}">${l} ${counts[k]}</span>`).join("")}</div>` : "")
      + (due.length ? `<div class="due">\u23F0 Follow up today: ${due.map((r) => esc(r.author_name)).join(", ")}</div>` : "")
      + (rows.length
      ? `<table class="tracker"><thead><tr><th>Professor</th><th>Status</th><th>Follow up</th><th>Email</th><th></th></tr></thead><tbody>`
        + rows.map((r) => `<tr data-row="${esc(r.author_name)}">
          <td>${r.openalex_id ? `<a href="#" class="prof-open" data-oa="${esc(r.openalex_id)}">${esc(r.author_name)}</a>` : `<a target="_blank" rel="noopener" href="https://openalex.org/works?search=${encodeURIComponent(r.author_name)}">${esc(r.author_name)}</a>`}${r.institution ? `<br><small>${esc(r.institution)}</small>` : ""}</td>
          <td><select data-field="status">${STATUSES.map(([k, l]) => `<option value="${k}" ${(r.status || "saved") === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
          <td><input type="date" data-field="follow_up_on" value="${r.follow_up_on || ""}"></td>
          <td><input type="email" data-field="contact_email" placeholder="from faculty page" value="${esc(r.contact_email || "")}" maxlength="254"></td>
          <td class="acts"><button class="link-btn draft-btn" data-draft="${esc(r.author_name)}" data-inst="${esc(r.institution || "")}" data-oa="${esc(r.openalex_id || "")}">draft ($0.25)</button>
            <button class="link-btn" data-remove="${esc(r.author_name)}">remove</button></td></tr>
          <tr class="note-row"><td colspan="5"><input class="note" data-field="note" data-for="${esc(r.author_name)}" placeholder="Notes (what they work on, what you asked)" value="${esc(r.note || "")}" maxlength="2000">
            <div class="draft-out" data-for="${esc(r.author_name)}"></div></td></tr>`).join("")
        + `</tbody></table>`
      : "<p>Use <b>Find professors</b> above, or click the \u2606 next to any faculty member, to start your list.</p>");
    el.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = () => remove(b.dataset.remove)));
    el.querySelectorAll("[data-draft]").forEach((b) => (b.onclick = () => draftEmail(b)));
    el.querySelectorAll(".prof-open").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openProfessor(a.dataset.oa); }));
    el.querySelectorAll("[data-field]").forEach((inp) => (inp.onchange = () => {
      const name = inp.dataset.for || inp.closest("tr").dataset.row;
      updateRow(name, { [inp.dataset.field]: inp.value || null });
    }));
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
      try { const d = await callDraft({ action: "profile" }); setCredits(d.credits_cents); renderProfile(); }
      catch (e) { $("#build-msg").textContent = e.message; }
    };
  }
  function toggleProfile() { const el = $("#my-profile"); el.hidden = !el.hidden; renderProfile(); }

  async function draftEmail(btn) {
    const out = document.querySelector(`.draft-out[data-for="${CSS.escape(btn.dataset.draft)}"]`);
    out.innerHTML = "<small>Reading their recent papers and drafting...</small>";
    try {
      const d = await callDraft({ action: "email", author_name: btn.dataset.draft, institution: btn.dataset.inst || undefined, openalex_id: btn.dataset.oa || undefined });
      setCredits(d.credits_cents);
      const cur = saved.get(btn.dataset.draft);
      if (cur && (cur.status || "saved") === "saved") updateRow(btn.dataset.draft, { status: "drafted" });
      out.innerHTML = `<div class="draft"><div><b>Subject:</b> <span class="d-subj">${esc(d.subject)}</span> <button class="link-btn" data-copy="subj">copy</button></div>
        <pre class="d-body">${esc(d.body)}</pre><button class="link-btn" data-copy="body">copy body</button>
        <small class="hint">Check every claim before sending. Find their email on their faculty page.</small></div>`;
      out.querySelector('[data-copy="subj"]').onclick = (e) => copy(d.subject, e.target);
      out.querySelector('[data-copy="body"]').onclick = (e) => copy(d.body, e.target);
    } catch (e) { out.innerHTML = `<small class="err">${esc(e.message)}</small>`; }
  }
  async function copy(text, el) { await navigator.clipboard.writeText(text); const t = el.textContent; el.textContent = "copied"; setTimeout(() => (el.textContent = t), 1200); }

  async function load() {
    saved = new Map();
    if (user) {
      await refreshCredits();
      const { data, error } = await sb.from("saved_professors").select("*");
      if (error) console.error(error); else data.forEach((r) => saved.set(r.author_name, r));
    }
    renderBar(); renderList(); paintStars();
  }

  async function remove(name) {
    const { error } = await sb.from("saved_professors").delete().eq("author_name", name);
    if (error) return alert("Could not remove: " + error.message);
    saved.delete(name); renderBar(); renderList(); paintStars();
  }

  async function toggle(btn) {
    if (!user) { $("#signin-email") && $("#signin-email").focus(); $("#signin-msg").textContent = "Sign in to save professors."; return; }
    if (!ageOk()) { $("#age-year") && $("#age-year").focus(); return; }
    const name = btn.dataset.name;
    if (saved.has(name)) return remove(name);
    const row = { author_name: name, institution: btn.dataset.inst || null, orcid: btn.dataset.orcid || null, openalex_id: btn.dataset.oa || null };
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
      const r = await fetch(SUPABASE_URL + "/functions/v1/find", {
        method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ query: q, country: $("#find-country").value || undefined, years: 3 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Search failed");
      if (!d.professors.length) { out.innerHTML = "<p>No active labs found in the last few years. Try broader or different words (e.g. the technique instead of the application).</p>"; return; }
      out.innerHTML = `<p class="hint">${d.professors.length} professors leading recent work on <b>${esc(d.query)}</b> (from ${d.matched_papers} papers in the last ${d.years} years). Ranked by how much recent, relevant work they lead.</p>`
        + d.professors.map((p) => `<div class="prof-card">
          <div class="pc-head"><button class="save-star" data-name="${esc(p.name)}" data-inst="${esc(p.institution || "")}" data-orcid="${esc(p.orcid || "")}" data-oa="${esc(p.id)}" title="Save">\u2606</button>
            <b><a href="#" class="prof-open" data-oa="${esc(p.id)}">${esc(p.name)}</a></b>
            <span class="pc-inst">${esc(p.institution || "")}</span> <span class="pc-active">active ${p.latest_year}</span></div>
          <ul>${p.papers.map((x) => `<li>${x.doi ? `<a target="_blank" rel="noopener" href="${esc(x.doi)}">${esc(x.title)}</a>` : esc(x.title)} <small>(${x.year}${x.venue ? ", " + esc(x.venue) : ""})</small></li>`).join("")}</ul></div>`).join("");
      out.querySelectorAll(".save-star").forEach((b) => (b.onclick = () => toggle(b)));
      out.querySelectorAll(".prof-open").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openProfessor(a.dataset.oa); }));
      paintStars();
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
        <h3>${esc(p.name)} <button class="save-star" data-name="${esc(p.name)}" data-inst="${esc(p.institutions[0] || "")}" data-orcid="${esc(p.orcid || "")}" data-oa="${esc(p.id)}">\u2606</button></h3>
        <div class="pp-inst">${esc(p.institutions.join(" \u00b7 ") || "Institution unknown")}</div>
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
      panel.querySelectorAll(".prof-open").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openProfessor(a.dataset.oa); }));
      paintStars();
    } catch (e) { panel.innerHTML = `<button class="pp-close" aria-label="Close">\u2715</button><p class="err">${esc(e.message)}</p>`; panel.querySelector(".pp-close").onclick = () => panel.classList.remove("open"); }
  }
  window.srOpenProfessor = openProfessor;
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
