// POST /functions/v1/account  (caller's Supabase JWT required)
//   { action: "export" }  -> everything we store about the caller, as one JSON object
//   { action: "delete" }  -> cancels any Stripe subscription, then deletes the account and all its data
// Deletion cascades through every user table (foreign keys use on delete cascade; feedback keeps the
// text but drops the link). Stripe keeps its own payment records, which the law requires.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function stripe(method: string, path: string) {
  const r = await fetch("https://api.stripe.com/v1/" + path, { method, headers: { Authorization: "Bearer " + Deno.env.get("STRIPE_SECRET_KEY") } });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message ?? "Stripe error");
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const [{ data: { user } }, body] = await Promise.all([admin.auth.getUser(jwt), req.json().catch(() => ({}))]);
  if (!user) return json({ error: "Sign in first." }, 401);

  if (body.action === "export") {
    const q = (t: string, cols = "*") => admin.from(t).select(cols).eq(t === "profiles" ? "id" : "user_id", user.id);
    const [profile, docs, saved, drafts, ledger] = await Promise.all([
      q("profiles"), q("user_docs"), q("saved_professors"), q("drafts"), q("credit_ledger"),
    ]);
    return json({
      exported_at: new Date().toISOString(),
      account: { id: user.id, email: user.email, created_at: user.created_at, last_sign_in_at: user.last_sign_in_at },
      profile: profile.data?.[0] ?? null, documents: docs.data ?? [], saved_professors: saved.data ?? [],
      drafts: drafts.data ?? [], credit_history: ledger.data ?? [],
    });
  }

  if (body.action === "delete") {
    if (body.confirm !== "DELETE") return json({ error: "Type DELETE to confirm." }, 400);
    const { data: prof } = await admin.from("profiles").select("stripe_customer_id").eq("id", user.id).single();
    // Stop future charges first. If Stripe is down we refuse to delete, so nobody keeps paying for a ghost account.
    // Covers the student's own subscription (by customer) and a parent's (subscription metadata names the student).
    if (Deno.env.get("STRIPE_SECRET_KEY")) {
      try {
        const own = prof?.stripe_customer_id ? (await stripe("GET", `subscriptions?customer=${prof.stripe_customer_id}&status=all&limit=20`)).data ?? [] : [];
        const theirs = (await stripe("GET", `subscriptions/search?query=${encodeURIComponent(`metadata['user_id']:'${user.id}'`)}&limit=20`)).data ?? [];
        for (const s of [...own, ...theirs]) if (!["canceled", "incomplete_expired"].includes(s.status)) await stripe("DELETE", "subscriptions/" + s.id);
      } catch (e) {
        return json({ error: "Couldn't cancel your subscription, so nothing was deleted. Try again or email hello@needalab.com. (" + (e as Error).message + ")" }, 502);
      }
    }
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
});
