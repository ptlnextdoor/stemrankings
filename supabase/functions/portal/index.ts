// POST /functions/v1/portal
//   { action: "feedback", feature, roast, page }   anyone (signed in or not) can roast a feature
//   { action: "dashboard" }                         owner only: users, usage, costs inputs, revenue
// Owner = OWNER_EMAILS secret (comma separated), default aayu22809@gmail.com. The email comes from
// the verified Supabase JWT, never from the request body.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const OWNERS = (Deno.env.get("OWNER_EMAILS") ?? "aayu22809@gmail.com").toLowerCase().split(",").map((s) => s.trim());

// Stripe money in: succeeded charges, minus fees and refunds, from balance transactions (last 100).
async function stripeMoney() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return { error: "no Stripe key" };
  const r = await fetch("https://api.stripe.com/v1/balance_transactions?limit=100", { headers: { Authorization: "Bearer " + key } });
  const d = await r.json();
  if (!r.ok) return { error: d.error?.message ?? "Stripe error " + r.status };
  let gross = 0, fees = 0, refunds = 0;
  const recent = [];
  for (const t of d.data ?? []) {
    if (t.type === "charge" || t.type === "payment") { gross += t.amount; fees += t.fee; }
    else if (t.type === "refund" || t.type === "payment_refund") refunds += -t.amount;
    else if (t.type === "stripe_fee") fees += -t.amount;
    recent.push({ at: t.created, type: t.type, amount: t.amount, fee: t.fee, net: t.net, currency: t.currency });
  }
  return { gross_cents: gross, fees_cents: fees, refunds_cents: refunds, net_cents: gross - fees - refunds, recent: recent.slice(0, 20), more: !!d.has_more };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const [{ data: { user } }, body] = await Promise.all([
    jwt ? admin.auth.getUser(jwt) : Promise.resolve({ data: { user: null } }),
    req.json().catch(() => ({})),
  ]);

  if (body.action === "feedback") {
    const feature = String(body.feature ?? "").trim().slice(0, 80);
    const roast = String(body.roast ?? "").trim().slice(0, 4000);
    if (!feature || roast.length < 3) return json({ error: "Pick a feature and tell us what's wrong." }, 400);
    // 5 roasts/day per account or network keeps the inbox readable without a CAPTCHA.
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    const { data: ok } = await admin.rpc("take_search", { p_who: "fb:" + (user?.id ?? ip), p_limit: 5 });
    if (ok === false) return json({ error: "Thanks, that's plenty for today. Come back tomorrow." }, 429);
    const { error } = await admin.from("feedback").insert({
      user_id: user?.id ?? null, email: user?.email ?? null, feature, roast, page: String(body.page ?? "").slice(0, 200) || null,
    });
    if (error) return json({ error: "Couldn't save that. Try again." }, 500);
    return json({ ok: true });
  }

  if (body.action === "dashboard") {
    if (!user || !OWNERS.includes((user.email ?? "").toLowerCase())) return json({ error: "Not found" }, 404);
    const [{ data, error }, money] = await Promise.all([admin.rpc("owner_dashboard"), stripeMoney()]);
    if (error) return json({ error: error.message }, 500);
    return json({ ...data, stripe: money });
  }
  return json({ error: "Unknown action" }, 400);
});
