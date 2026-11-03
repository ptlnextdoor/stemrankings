// Wires the Etch liquid kit (spring.js + goo.js, copied from github.com/ptlnextdoor/etch) into needalab:
// every button and button-like link gets the springy press squish, including ones the app renders later.
import { squish } from "./goo.js";

const SEL = "button, .btn, .draft-btn, .btn-primary";
const bind = (root) => root.querySelectorAll(SEL).forEach((el) => { if (!el.dataset.lq) squish(el, { amount: 0.6 }); });

bind(document);
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches?.(SEL)) squish(n, { amount: 0.6 }); bind(n); }
}).observe(document.body, { childList: true, subtree: true });
