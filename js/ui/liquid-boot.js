// needalab motion layer, built on the Etch kit (spring.js + goo.js, from github.com/ptlnextdoor/etch).
//   1. press squish + wobble on every button (goo.js squish), including ones rendered later
//   2. "Where" chips: a goo drop (two blobs on different springs + a thinning neck) travels to the picked chip
//   3. result cards: staggered rise (CSS), then lift on hover and squish on press, all on springs
//   4. the hero line settles in once on load
// Everything respects prefers-reduced-motion (spring.js jumps instead of animating).
import { spring, reducedMotion } from "./spring.js";
import { gooFilter, squish } from "./goo.js";

const $ = (s, r = document) => r.querySelector(s);

// ---------- 1. buttons ----------
const PRESS = "button, .btn, .draft-btn, .btn-primary";
const bindPress = (root) => root.querySelectorAll(PRESS).forEach((el) => {
  if (!el.dataset.lq && !el.classList.contains("save-star") && !el.classList.contains("lq-chip")) squish(el, { amount: 0.7 });
});

// ---------- 3. cards: lift + press on springs ----------
function springy(c) {
  if (c.dataset.sp) return;
  c.dataset.sp = "1";
  let lift = 0, press = 0;
  const draw = () => {
    const y = ly.value, p = sq.value;
    c.style.transform = Math.abs(y) > 1e-4 || Math.abs(p) > 1e-4
      ? `translateY(${(-3 * y).toFixed(2)}px) scale(${(1 + 0.008 * p).toFixed(4)}, ${(1 - 0.014 * p).toFixed(4)})` : "";
  };
  const ly = spring(0, { stiffness: 300, damping: 26, onUpdate: draw });
  const sq = spring(0, { stiffness: 600, damping: 34, onUpdate: draw });
  const go = () => { ly.set(lift); sq.set(press); };
  c.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { lift = 1; go(); } });
  c.addEventListener("pointerleave", () => { lift = 0; press = 0; go(); });
  c.addEventListener("pointerdown", (e) => { if (e.button === 0 && !e.target.closest("a,button,input,textarea,select")) { press = 1; go(); } });
  for (const t of ["pointerup", "pointercancel"]) c.addEventListener(t, () => { press = 0; go(); });
}
function bindCards(root) {
  root.querySelectorAll(".prof-card").forEach((c, i) => { if (!c.dataset.sp) { c.style.setProperty("--i", String(Math.min(i % 25, 12))); springy(c); } });
}

// star: a little pop on spring when it turns on
function popStar(b) {
  const s = spring({ k: 1 }, { preset: "wobbly", precision: 0.001, onUpdate: (v) => { b.style.scale = v.k === 1 ? "" : String(v.k); } });
  s.jump({ k: 0.7 }); s.set({ k: 1 });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".save-star");
  if (b) requestAnimationFrame(() => { if (b.classList.contains("on")) popStar(b); });
}, true);

// ---------- 2. Where chips with the goo drop ----------
function whereChips() {
  const host = $("#where-chips"), sel = $("#find-country");
  if (!host || !sel) return;
  const goo = $(".goo", host), [bA, bB] = goo.querySelectorAll(".blob"), bridge = $(".bridge", goo);
  goo.style.filter = gooFilter({ id: "nl-goo", blur: 7, alpha: 22, shift: -9 });
  const CHIPS = [["US", "United States"], ["", "Anywhere"], ["EUROPE", "Europe"], ["EAST_ASIA", "East Asia"], ["GB", "UK"], ["CA", "Canada"]];
  const chips = CHIPS.map(([v, label]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "lq-chip"; b.dataset.v = v; b.textContent = label;
    b.addEventListener("click", () => { sel.value = v; paint(); });
    host.append(b);
    return b;
  });
  // the full list stays available as a pill-shaped select next to the chips
  sel.classList.add("lq-more");
  sel.addEventListener("change", paint);

  let H = 36, top = 0, want = 0, ready = false, onEl = null;
  const mk = (el, k, d) => {
    const o = {};
    o.x = spring(0, { stiffness: k, damping: d, precision: 0.1, onUpdate: () => draw(el, o) });
    o.w = spring(0, { stiffness: k, damping: d, precision: 0.1, onUpdate: () => draw(el, o) });
    return o;
  };
  let tail = null;
  const lead = mk(bA, 420, 30);
  tail = mk(bB, 190, 21);
  function draw(el, o) {
    el.style.transform = `translate(${o.x.value}px, ${top}px)`;
    el.style.width = Math.max(0, o.w.value) + "px";
    if (!tail) return;
    // a neck between the blobs that thins as they pull apart, so the drop pinches instead of snapping
    const R = H / 2, l = Math.min(lead.x.value, tail.x.value) + R;
    const r = Math.max(lead.x.value + lead.w.value, tail.x.value + tail.w.value) - R;
    const span = Math.max(0, r - l), stretch = want ? span / Math.max(1, want - H) : 1;
    const th = Math.max(10, Math.min(H, H / Math.max(1, stretch * 0.9)));
    bridge.style.width = span + "px"; bridge.style.height = th + "px";
    bridge.style.transform = `translate(${l}px, ${top + (H - th) / 2}px)`;
  }
  function paint() {
    const on = chips.find((c) => c.dataset.v === sel.value) || null;
    chips.forEach((c) => { c.classList.toggle("on", c === on); c.setAttribute("aria-pressed", String(c === on)); });
    sel.classList.toggle("on", !on);
    if (!on || !on.offsetWidth) { goo.classList.remove("ready"); onEl = null; return; }
    const x = on.offsetLeft, w = on.offsetWidth;
    H = on.offsetHeight; top = on.offsetTop; want = w;
    for (const el of [bA, bB]) { el.style.height = H + "px"; el.style.borderRadius = H / 2 + "px"; }
    const jump = !ready || reducedMotion() || (on === onEl && !lead.x.moving);
    onEl = on;
    for (const b of [lead, tail]) jump ? (b.x.jump(x), b.w.jump(w)) : (b.x.set(x), b.w.set(w));
    if (!ready) { ready = true; goo.classList.add("ready"); }
  }
  for (const c of chips) squish(c, { amount: 0.8 });
  if ("ResizeObserver" in window) new ResizeObserver(() => paint()).observe(host);
  document.fonts?.ready.then(paint);
  paint();
}

// ---------- 4. hero settles in once ----------
function heroIn() {
  const h = $(".hero-h");
  if (!h || reducedMotion()) return;
  const s = spring({ y: 14, o: 0 }, { stiffness: 170, damping: 20, precision: 0.01, onUpdate: (v) => {
    h.style.transform = v.y ? `translateY(${v.y.toFixed(2)}px)` : ""; h.style.opacity = v.o >= 0.999 ? "" : String(v.o);
  } });
  s.set({ y: 0, o: 1 });
}

// ---------- boot ----------
heroIn();
whereChips();
bindPress(document);
bindCards(document);
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.matches?.(PRESS)) bindPress(n.parentNode || n); else bindPress(n);
    bindCards(n.parentNode || n);
  }
}).observe(document.body, { childList: true, subtree: true });
