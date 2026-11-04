// needalab voice: the same interface as Etch's js/voice.js (createVoice + speakable), but browser-only. Listening uses
// the browser's SpeechRecognition (Chrome, Edge, Safari); speaking uses speechSynthesis. No server, no audio upload.
// The dock drives it through js/ui/voice-adapter.js exactly as in Etch.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function speakable(md, max = 2) {
  const t = String(md || "").replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\s+/g, " ").trim();
  const s = t.split(/(?<=[.!?])\s+/).slice(0, max).join(" ");
  return s.length > 380 ? s.slice(0, 377).replace(/\s+\S*$/, "") + "…" : s;
}

export function createVoice(h) {
  const v = { engine: SR ? "browser" : null, tts: "speechSynthesis" in window, available: !!SR, vmode: false, talked: false, listenAfter: false };
  const state = (s, d) => h.onState?.(s, d);
  const level = (who, x) => h.onLevel?.(who, x);
  let rec = null, finalText = "", meter = 0;
  v.ready = Promise.resolve(v.engine);
  if (!SR) queueMicrotask(() => state("off", "Voice isn't available in this browser. Type instead."));

  function stopSpeaking() { try { speechSynthesis.cancel(); } catch { /* none */ } level("etch", 0); }
  function say(text) {
    const t = String(text || "").trim();
    if (!t || !v.tts || !v.talked) return;
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(t);
    u.rate = 1.04;
    let iv = 0;
    u.onstart = () => { state("speaking"); iv = setInterval(() => level("etch", 0.25 + 0.3 * Math.abs(Math.sin(performance.now() / 95))), 60); };
    u.onend = u.onerror = () => {
      clearInterval(iv); level("etch", 0); state("idle");
      if (v.listenAfter) { v.listenAfter = false; setTimeout(() => start({ auto: true }), 350); }
    };
    speechSynthesis.speak(u);
  }

  function start(o = {}) {
    if (!SR || rec) return;
    stopSpeaking();
    v.talked = true; v.vmode = true;
    const r = new SR();
    r.lang = navigator.language || "en-US"; r.interimResults = true; r.continuous = true;
    finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      h.onInterim?.((finalText + " " + interim).trim());
      level("you", Math.min(1, 0.35 + Math.random() * 0.5));
    };
    r.onerror = (e) => { if (e.error === "not-allowed") state("off", "Microphone is blocked. Allow it in the address bar, or type instead."); };
    r.onend = () => {
      clearInterval(meter); level("you", 0);
      const t = finalText.trim();
      rec = null;
      if (t) { state("transcribing"); h.onHeard?.(t); }
      state("idle");
    };
    rec = { r, auto: !!o.auto, held: !!o.held };
    // a soft idle level so the eyes and waveform breathe while the person talks
    meter = setInterval(() => level("you", 0.08 + Math.random() * 0.12), 90);
    r.start();
    state("listening", { held: !!o.held });
  }
  function finish() { if (rec) rec.r.stop(); }

  let downAt = 0;
  function bind(btn) {
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); if (rec) { v.vmode = false; finish(); return; } downAt = performance.now(); start(); });
    btn.addEventListener("pointerup", () => { if (rec && !rec.auto && performance.now() - downAt > 600) finish(); });
    btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (rec) finish(); else start(); } });
  }
  Object.defineProperty(v, "listening", { get: () => !!rec });
  return Object.assign(v, {
    bind, start, say,
    stop: () => { v.vmode = false; stopSpeaking(); finish(); },
    answer(md) { v.listenAfter = true; say(speakable(md)); },
  });
}
