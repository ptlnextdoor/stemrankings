// POST /functions/v1/stripe-webhook  (called by Stripe, not the browser)
// On every paid subscription invoice (first month and each renewal), grants CREDITS_PER_PERIOD
// cents to the user. Idempotent: the invoice id is the ledger ref, so Stripe retries can't double-grant.
// Needs secrets STRIPE_WEBHOOK_SECRET (and STRIPE_SECRET_KEY for lookups).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export const CREDITS_PER_PERIOD = 1000; // $10.00 of credits per paid month
const TOLERANCE_S = 300;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

// Stripe signature: header "t=<ts>,v1=<hmac>", HMAC-SHA256 over "<ts>.<raw body>".
export async function verifyStripe(raw: string, header: string | null, secret: string, now = Date.now() / 1000) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const ts = Number(parts.t);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!ts || !sigs.length || Math.abs(now - ts) > TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${raw}`)));
  // constant-time compare
  return sigs.some((s) => s.length === expected.length && [...s].reduce((acc, c, i) => acc | (c.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0);
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return new Response("not configured", { status: 503 });
  const raw = await req.text();
  if (!(await verifyStripe(raw, req.headers.get("stripe-signature"), secret))) {
    return new Response("bad signature", { status: 400 });
  }
  const event = JSON.parse(raw);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (event.type === "invoice.paid") {
    const inv = event.data.object;
    if (!inv.subscription || !(inv.amount_paid > 0)) return new Response("ignored", { status: 200 });
    // Find the user: subscription metadata first, then the customer we stored at checkout.
    let userId: string | undefined = inv.subscription_details?.metadata?.user_id
      ?? inv.lines?.data?.[0]?.metadata?.user_id;
    if (!userId && inv.customer) {
      const { data } = await admin.from("profiles").select("id").eq("stripe_customer_id", inv.customer).maybeSingle();
      userId = data?.id;
    }
    if (!userId) return new Response("unknown customer", { status: 200 });
    const { error } = await admin.rpc("grant_credits", { p_user: userId, p_amount: CREDITS_PER_PERIOD, p_reason: "subscription", p_ref: "invoice:" + inv.id });
    if (error) return new Response(error.message, { status: 500 }); // Stripe will retry
    await admin.from("profiles").update({ plan: "pro" }).eq("id", userId);
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const { data } = await admin.from("profiles").select("id").eq("stripe_customer_id", sub.customer).maybeSingle();
    // Remaining credits are kept; they just stop refilling.
    if (data) await admin.from("profiles").update({ plan: "free" }).eq("id", data.id);
  }

  return new Response("ok", { status: 200 });
});
