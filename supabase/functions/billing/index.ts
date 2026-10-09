// POST /functions/v1/billing  { action: "checkout" | "portal" }  (caller's Supabase JWT required)
// checkout: starts a Stripe Checkout subscription for the $10/month plan.
// portal:   opens the Stripe Customer Portal to cancel or update the card.
// Needs secrets STRIPE_SECRET_KEY and STRIPE_PRICE_ID. Until set, returns 503.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SITE = "https://ptlnextdoor.github.io/stemrankings/";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function stripe(path: string, params: Record<string, string>) {
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + Deno.env.get("STRIPE_SECRET_KEY"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message ?? "Stripe error");
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!Deno.env.get("STRIPE_SECRET_KEY") || !Deno.env.get("STRIPE_PRICE_ID")) {
    return json({ error: "Payments aren't switched on yet." }, 503);
  }
  const { action } = await req.json().catch(() => ({}));
  try {
    const { data: prof } = await admin.from("profiles").select("stripe_customer_id").eq("id", user.id).single();
    let customer = prof?.stripe_customer_id;
    if (!customer) {
      customer = (await stripe("customers", { email: user.email ?? "", "metadata[user_id]": user.id })).id;
      await admin.from("profiles").update({ stripe_customer_id: customer }).eq("id", user.id);
    }
    if (action === "portal") {
      const s = await stripe("billing_portal/sessions", { customer, return_url: SITE });
      return json({ url: s.url });
    }
    const s = await stripe("checkout/sessions", {
      mode: "subscription", customer,
      "line_items[0][price]": Deno.env.get("STRIPE_PRICE_ID")!, "line_items[0][quantity]": "1",
      client_reference_id: user.id, "subscription_data[metadata][user_id]": user.id,
      success_url: SITE + "?billing=success", cancel_url: SITE + "?billing=cancel",
    });
    return json({ url: s.url });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
