/* needalab first-party analytics: page views, funnel clicks and JS errors go to our own events table.
   No cookies, no IP stored, no third parties. sid is random per browser tab (sessionStorage). */
(function () {
  "use strict";
  const URL_ = "https://oxcnlommtnziwfbpxigd.supabase.co/rest/v1/events";
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94Y25sb21tdG56aXdmYnB4aWdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NDkzNTcsImV4cCI6MjEwNzEyNTM1N30._6MDpHUC41GsvD6OQJsn3AXlJBAlVqkq__46QwE_JH8";
  if (/^(localhost|127\.)/.test(location.hostname) && !/[?&]track=1\b/.test(location.search)) return window.nlTrack = () => {};
  let sid = sessionStorage.getItem("nl_sid");
  if (!sid) { sid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); sessionStorage.setItem("nl_sid", sid); }
  const sp = new URLSearchParams(location.search);
  let ref = sp.get("utm_source") || sp.get("ref") || "";
  try { if (!ref && document.referrer) { const h = new URL(document.referrer).hostname; if (h !== location.hostname) ref = h; } } catch { /* bad referrer */ }
  let sent = 0;
  function nlTrack(kind, detail) {
    if (sent++ > 60) return; // a runaway loop shouldn't flood the table
    const body = JSON.stringify({ kind, path: location.pathname.slice(0, 200), ref: ref.slice(0, 100) || null, detail: detail ? String(detail).slice(0, 500) : null, sid });
    fetch(URL_, { method: "POST", keepalive: true, headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json", Prefer: "return=minimal" }, body }).catch(() => {});
  }
  window.nlTrack = nlTrack;
  nlTrack("view");
  window.addEventListener("error", (e) => nlTrack("error", (e.message || "error") + " @ " + (e.filename || "").split("/").pop() + ":" + (e.lineno || 0)));
  window.addEventListener("unhandledrejection", (e) => nlTrack("error", "promise: " + ((e.reason && (e.reason.message || e.reason)) || "unknown")));
  // Funnel clicks by element id, so no other file needs to know about tracking.
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("#google-btn, #billing-btn, .save-star, .draft-btn, .pp-draft");
    if (!t) return;
    nlTrack(t.id === "google-btn" ? "signin_click" : t.id === "billing-btn" ? "checkout_click" : t.classList.contains("save-star") ? "save" : "draft");
  }, true);
  document.addEventListener("submit", (e) => {
    if (e.target.id === "find-form") nlTrack("search", (document.getElementById("find-q") || {}).value);
    if (e.target.id === "signin-form") nlTrack("signin_click", "email");
  }, true);
})();
