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
        <button id="signout-btn">Sign out</button>`;
      $("#signout-btn").onclick = () => sb.auth.signOut();
      $("#mylist-btn").onclick = toggleList;
    }
  }

  function renderList() {
    const el = $("#my-list");
    if (!user || el.hidden) return;
    const rows = [...saved.values()].sort((a, b) => a.author_name.localeCompare(b.author_name));
    el.innerHTML = `<h4>My saved professors (${rows.length})</h4>` + (rows.length
      ? "<ul>" + rows.map((r) => `<li><a target="_blank" rel="noopener" href="https://openalex.org/works?search=${encodeURIComponent(r.author_name)}">${esc(r.author_name)}</a>`
        + (r.institution ? ` <small>${esc(r.institution)}</small>` : "")
        + ` <button class="link-btn" data-remove="${esc(r.author_name)}">remove</button></li>`).join("") + "</ul>"
      : "<p>Click the \u2606 next to any faculty member to save them here.</p>");
    el.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = () => remove(b.dataset.remove)));
  }

  function toggleList() { const el = $("#my-list"); el.hidden = !el.hidden; renderList(); }

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
