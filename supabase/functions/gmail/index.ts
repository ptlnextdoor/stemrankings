// Supabase Edge Function: POST /functions/v1/gmail
// "Send from my Gmail" for outreach drafts. Ships dark behind a client feature flag; the
// gmail.send scope needs Google app verification before non-test users can use it.
//
// Body: { action: "connect", code }  -> exchange a GIS auth code for tokens, store the refresh
//                                        token ENCRYPTED, return the connected Gmail address.
//       { action: "status" }         -> { connected, gmail_address? }
//       { action: "disconnect" }     -> revoke at Google and delete the row
//       { action: "send", author_name, subject?, body? }
//                                     -> re-read the saved draft + saved_professors.contact_email
//                                        server-side, build the message, send via Gmail API,
//                                        mark the professor sent. Client may pass an edited
//                                        subject/body (capped + sanitized) but NOT the recipient.
//
// Auth: the caller's Supabase JWT. All DB writes use the service role after verifying the user.
// Secrets (never sent to the browser): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_TOKEN_KEY.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { buildRawMessage, clampBody, clampSubject, decryptToken, encryptToken, isEmail, LIMITS, sanitizeHeader } from "./mail.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

// Decode a JWT payload (id_token) without verifying the signature; we only read the email claim,
// and the token came straight from Google's token endpoint over TLS.
function jwtEmail(idToken: string): string | null {
  try {
    const part = idToken.split(".")[1];
    const pad = part.replace(/-/g, "+").replace(/_/g, "/");
    const obj = JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)));
    return obj.email ?? null;
  } catch { return null; }
}

// Exchange the GIS authorization code (code flow, redirect_uri 'postmessage') for tokens.
async function exchangeCode(code: string) {
  const id = Deno.env.get("GOOGLE_CLIENT_ID"), secret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!id || !secret) throw new Error("Gmail sending isn't configured yet.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: "postmessage", grant_type: "authorization_code" }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("Google rejected the connection: " + (d.error_description || d.error || r.status));
  return d as { access_token: string; refresh_token?: string; id_token?: string; scope?: string };
}

// A refresh token -> a short-lived access token for the Gmail API.
async function accessFromRefresh(refresh: string): Promise<string> {
  const id = Deno.env.get("GOOGLE_CLIENT_ID"), secret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refresh, client_id: id!, client_secret: secret!, grant_type: "refresh_token" }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("Gmail connection expired; reconnect. (" + (d.error || r.status) + ")");
  return d.access_token as string;
}

async function userinfoEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + accessToken } });
    if (!r.ok) return null;
    return (await r.json()).email ?? null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return json({ error: "Sign in first." }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const action = body.action;
  const tokenKey = Deno.env.get("GMAIL_TOKEN_KEY") ?? "";

  try {
    if (action === "status") {
      const { data } = await admin.from("gmail_connections").select("gmail_address").eq("user_id", user.id).maybeSingle();
      return json({ connected: !!data, gmail_address: data?.gmail_address ?? null });
    }

    if (action === "connect") {
      const code = String(body.code ?? "").trim();
      if (!code) return json({ error: "Missing authorization code." }, 400);
      if (!tokenKey) return json({ error: "Gmail sending isn't configured yet." }, 503);
      const tok = await exchangeCode(code);
      if (!tok.refresh_token) {
        return json({ error: "Google didn't return a refresh token. Remove STEMRankings at myaccount.google.com/permissions, then reconnect." }, 400);
      }
      if (tok.scope && !tok.scope.split(/\s+/).includes(GMAIL_SCOPE)) {
        return json({ error: "The Gmail send permission wasn't granted." }, 400);
      }
      const gmailAddress = (tok.id_token && jwtEmail(tok.id_token)) || await userinfoEmail(tok.access_token);
      if (!gmailAddress || !isEmail(gmailAddress)) return json({ error: "Couldn't read your Gmail address." }, 502);
      const enc = await encryptToken(tok.refresh_token, tokenKey);
      const { error } = await admin.from("gmail_connections").upsert({
        user_id: user.id, gmail_address: gmailAddress, refresh_token_enc: enc, connected_at: new Date().toISOString(),
      });
      if (error) return json({ error: error.message }, 500);
      return json({ connected: true, gmail_address: gmailAddress });
    }

    if (action === "disconnect") {
      const { data } = await admin.from("gmail_connections").select("refresh_token_enc").eq("user_id", user.id).maybeSingle();
      if (data?.refresh_token_enc && tokenKey) {
        try {
          const refresh = await decryptToken(data.refresh_token_enc, tokenKey);
          await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: refresh }),
          });
        } catch { /* revoke best-effort; still delete the row below */ }
      }
      await admin.from("gmail_connections").delete().eq("user_id", user.id);
      return json({ connected: false });
    }

    if (action === "send") {
      // COPPA: service role bypasses RLS, so re-check the age gate here.
      const { data: prof } = await admin.from("profiles").select("birth_year, display_name").eq("id", user.id).single();
      if (!prof?.birth_year || prof.birth_year > new Date().getFullYear() - 13) {
        return json({ error: "You need to be 13 or older to use this.", age: true }, 403);
      }

      const authorName = sanitizeHeader(String(body.author_name ?? "")).slice(0, 200);
      if (!authorName) return json({ error: "author_name required" }, 400);

      // Must be connected.
      const { data: conn } = await admin.from("gmail_connections").select("gmail_address, refresh_token_enc").eq("user_id", user.id).maybeSingle();
      if (!conn) return json({ error: "Connect your Gmail first.", needs_connect: true }, 409);

      // Re-read the saved professor row server-side; never trust a client-supplied recipient.
      const { data: sp } = await admin.from("saved_professors")
        .select("author_name, contact_email, status, sent_at")
        .eq("user_id", user.id).eq("author_name", authorName).maybeSingle();
      if (!sp) return json({ error: "That professor isn't on your list." }, 404);
      const to = String(sp.contact_email ?? "").trim();
      if (!isEmail(to)) return json({ error: "Add a valid email for this professor first." }, 400);

      // Per-professor rule: one send per professor per 7 days.
      if (sp.sent_at) {
        const days = (Date.now() - new Date(sp.sent_at).getTime()) / 86400000;
        if (days < LIMITS.perProfDays) {
          return json({ error: `You already emailed ${authorName} in the last ${LIMITS.perProfDays} days.` }, 429);
        }
      }

      // Daily cap: 20 sends/user/day, atomic via take_search with the 'gm:' prefix.
      const { data: within, error: capErr } = await admin.rpc("take_search", { p_who: "gm:" + user.id, p_limit: LIMITS.perDay });
      if (capErr) return json({ error: capErr.message }, 500);
      if (within === false) return json({ error: `Daily limit reached (${LIMITS.perDay} emails/day).` }, 429);

      // The saved draft is the source of truth for content; allow the user's edits but cap them.
      const { data: draft } = await admin.from("drafts")
        .select("subject, body").eq("user_id", user.id).eq("author_name", authorName)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const subject = clampSubject(body.subject != null ? String(body.subject) : (draft?.subject ?? ""));
      const content = clampBody(body.body != null ? String(body.body) : (draft?.body ?? ""));
      if (!subject || !content) return json({ error: "Draft an email first." }, 400);

      // Build + send.
      const refresh = await decryptToken(conn.refresh_token_enc, tokenKey);
      const accessToken = await accessFromRefresh(refresh);
      const raw = buildRawMessage({ fromName: prof.display_name ?? undefined, fromEmail: conn.gmail_address, to, subject, body: content });
      const send = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      const sd = await send.json();
      if (!send.ok) return json({ error: "Gmail couldn't send it: " + (sd.error?.message || send.status) }, 502);

      // Mark sent (trigger sets sent_at/follow_up_on) and store the Gmail message id.
      await admin.from("saved_professors")
        .update({ status: "sent", sent_message_id: sd.id ?? null })
        .eq("user_id", user.id).eq("author_name", authorName);
      return json({ sent: true, gmail_address: conn.gmail_address, message_id: sd.id ?? null });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
