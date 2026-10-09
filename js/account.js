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
    } else {
      bar.innerHTML = `<span class="acct-who">Signed in as <b>${esc(user.email)}</b></span>
        <button id="mylist-btn">My list (${saved.size})</button>
        <button id="profile-btn">My profile</button>
        <button id="signout-btn">Sign out</button>`;
      $("#signout-btn").onclick = () => sb.auth.signOut();
      $("#mylist-btn").onclick = toggleList;
      $("#profile-btn").onclick = toggleProfile;
    }
  }

  function renderList() {
    const el = $("#my-list");
    if (!user || el.hidden) return;
    const rows = [...saved.values()].sort((a, b) => a.author_name.localeCompare(b.author_name));
    el.innerHTML = `<h4>My saved professors (${rows.length})</h4>` + (rows.length
      ? "<ul>" + rows.map((r) => `<li><a target="_blank" rel="noopener" href="https://openalex.org/works?search=${encodeURIComponent(r.author_name)}">${esc(r.author_name)}</a>`
        + (r.institution ? ` <small>${esc(r.institution)}</small>` : "")
        + ` <button class="link-btn draft-btn" data-draft="${esc(r.author_name)}" data-inst="${esc(r.institution || "")}">draft email</button>`
        + ` <button class="link-btn" data-remove="${esc(r.author_name)}">remove</button>`
        + `<div class="draft-out" data-for="${esc(r.author_name)}"></div></li>`).join("") + "</ul>"
      : "<p>Click the \u2606 next to any faculty member to save them here.</p>");
    el.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = () => remove(b.dataset.remove)));
    el.querySelectorAll("[data-draft]").forEach((b) => (b.onclick = () => draftEmail(b)));
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
        <button id="build-profile" ${docs && docs.length ? "" : "disabled"}>${prof && prof.profile_summary ? "Rebuild profile" : "Build profile"}</button> <span id="build-msg" class="acct-msg"></span></div>`;
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
      try { await callDraft({ action: "profile" }); renderProfile(); }
      catch (e) { $("#build-msg").textContent = e.message; }
    };
  }
  function toggleProfile() { const el = $("#my-profile"); el.hidden = !el.hidden; renderProfile(); }

  async function draftEmail(btn) {
    const out = document.querySelector(`.draft-out[data-for="${CSS.escape(btn.dataset.draft)}"]`);
    out.innerHTML = "<small>Reading their recent papers and drafting...</small>";
    try {
      const d = await callDraft({ action: "email", author_name: btn.dataset.draft, institution: btn.dataset.inst || undefined });
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
      const { data, error } = await sb.from("saved_professors").select("author_name,institution,orcid,note,created_at");
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
    const name = btn.dataset.name;
    if (saved.has(name)) return remove(name);
    const row = { author_name: name, institution: btn.dataset.inst || null, orcid: btn.dataset.orcid || null };
    const { error } = await sb.from("saved_professors").insert(row);
    if (error) return alert("Could not save: " + error.message);
    saved.set(name, row); renderBar(); renderList(); paintStars();
  }

  sb.auth.onAuthStateChange((_event, session) => {
    const next = session ? session.user : null;
    if ((next && next.id) === (user && user.id)) return;
    user = next; load();
  });
  sb.auth.getSession().then(({ data }) => { user = data.session ? data.session.user : null; load(); });

  window.srAccount = { toggle, paintStars, _client: sb };
})();
