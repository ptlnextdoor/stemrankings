// Supabase Edge Function: POST /functions/v1/draft
// Body: { action: "profile" }                  -> rebuilds profiles.profile_summary from user_docs
//       { action: "email", author_name, institution? } -> drafts one email to that professor
// Auth: the caller's Supabase JWT. All writes use the service role after verifying the user.
// LLM: uses ANTHROPIC_API_KEY if set, else GEMINI_API_KEY. Neither is ever sent to the browser.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Prices in cents. Plan = $10/month buys 1000 cents. Raw model cost per draft is ~1 cent with
// Haiku; the margin covers Stripe fees, OpenAlex lookups and failed generations.
export const PRICE = { profile: 10, email: 25 };
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Phrases that make professors stop reading. The model is told to avoid them; we also strip
// any draft that still contains them and regenerate once.
export const BANNED = [
  "i hope this email finds you well", "i am writing to express", "i was deeply inspired",
  "groundbreaking", "fascinated by your", "truly inspiring", "i have always been passionate",
  "esteemed", "renowned", "pioneering work", "your incredible", "i am thrilled",
  "it would be an honor", "deeply passionate", "i came across your impressive",
];
export const hasBanned = (t: string) => BANNED.filter((p) => t.toLowerCase().includes(p));

async function llm(system: string, user: string, maxTokens = 700): Promise<string> {
  const ak = Deno.env.get("ANTHROPIC_API_KEY"), gk = Deno.env.get("GEMINI_API_KEY");
  if (ak) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ak, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error("LLM error: " + (d.error?.message ?? r.status));
    return d.content.map((c: { text?: string }) => c.text ?? "").join("");
  }
  if (gk) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${gk}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error("LLM error: " + (d.error?.message ?? r.status));
    return d.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  }
  throw new Error("NO_LLM_KEY");
}

// Rebuild an abstract from OpenAlex's inverted index.
function abstractOf(inv: Record<string, number[]> | null): string {
  if (!inv) return "";
  const words: string[] = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.join(" ").slice(0, 600);
}

export async function recentPapers(name: string, institution?: string) {
  const mail = "mailto=stemrankings@example.com";
  const a = await (await fetch(`https://api.openalex.org/authors?search=${encodeURIComponent(name)}&per-page=5&select=id,display_name,last_known_institutions,works_count&${mail}`)).json();
  let cand = a.results ?? [];
  if (institution) {
    const hit = cand.find((c: any) => (c.last_known_institutions ?? []).some((i: any) => i.display_name === institution));
    if (hit) cand = [hit];
  }
  const author = cand[0];
  if (!author) return [];
  const id = author.id.split("/").pop();
  const w = await (await fetch(`https://api.openalex.org/works?filter=author.id:${id},type:article&sort=publication_date:desc&per-page=4&select=title,publication_year,abstract_inverted_index,doi&${mail}`)).json();
  return (w.results ?? []).map((x: any) => ({ title: x.title, year: x.publication_year, doi: x.doi, abstract: abstractOf(x.abstract_inverted_index) }));
}

export const PROFILE_SYSTEM = `You condense a student's documents into a factual profile used to write research outreach emails.
Output plain text, at most 180 words, in this order:
1. Current stage (grade or year, school if given).
2. Concrete skills and tools, only ones evidenced in the documents.
3. 2 to 4 strongest experiences, each with what they did and a measurable result if stated.
4. Research interests as stated by the student.
Never invent facts, numbers, awards, or affiliations. If something isn't in the documents, omit it. No adjectives like "passionate" or "driven".`;

export const EMAIL_SYSTEM = `You write a short cold email from a student to a professor asking about research opportunities.
Rules:
- 90 to 140 words in the body. Plain text. No bullet points.
- First sentence: who the student is in one line (stage + the single most relevant experience).
- Second: name ONE specific paper of the professor's from the list given, and state a concrete connection to the student's own work or a specific question about it. Do not summarize the paper back to them.
- Then: one sentence with the most relevant evidence the student can contribute (a skill or result from the profile).
- Then: a specific, small ask (e.g. "Would you be open to a 15-minute call?" or "Are you taking students for the summer?"). One ask only.
- Sign off with just the student's first name placeholder: [Your name].
- No flattery. Never use: ${BANNED.join("; ")}.
- Do not invent anything about the student or the professor beyond what is provided.
- Subject line: under 9 words, specific (mention the topic), no "Inquiry" or "Opportunity".
Return exactly:
SUBJECT: <subject>
BODY:
<body>`;

export function parseEmail(t: string) {
  const s = t.match(/SUBJECT:\s*(.+)/i)?.[1]?.trim() ?? "";
  const b = t.split(/BODY:\s*/i)[1]?.trim() ?? "";
  return { subject: s, body: b };
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

  const { data: prof } = await admin.from("profiles").select("profile_summary, credits_cents").eq("id", user.id).single();
  const kind = body.action === "profile" ? "profile" : body.action === "email" ? "email" : null;
  if (!kind) return json({ error: "Unknown action" }, 400);

  // Cheap validation before charging anything.
  if (kind === "profile") {
    const { count } = await admin.from("user_docs").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    if (!count) return json({ error: "Add your resume, bio or past work first." }, 400);
  } else {
    if (!String(body.author_name ?? "").trim()) return json({ error: "author_name required" }, 400);
    if (!prof?.profile_summary) return json({ error: "Build your profile first." }, 400);
  }
  if (!Deno.env.get("ANTHROPIC_API_KEY") && !Deno.env.get("GEMINI_API_KEY")) {
    return json({ error: "Email drafting isn't switched on yet (no AI key configured)." }, 503);
  }

  // Reserve credits up front (atomic, so parallel requests can't overspend); refund on failure.
  const { data: balance, error: spendErr } = await admin.rpc("spend_credits", { p_user: user.id, p_cost: PRICE[kind], p_reason: kind });
  if (spendErr) {
    if (/INSUFFICIENT_CREDITS/.test(spendErr.message)) {
      return json({ error: `Not enough credits (this costs $${(PRICE[kind] / 100).toFixed(2)}, you have $${((prof?.credits_cents ?? 0) / 100).toFixed(2)}).`, credits: true }, 402);
    }
    return json({ error: spendErr.message }, 500);
  }
  const refund = () => admin.rpc("grant_credits", { p_user: user.id, p_amount: PRICE[kind], p_reason: "refund", p_ref: "refund:" + crypto.randomUUID() });

  // Every non-success path below refunds; only a delivered result keeps the charge.
  const fail = async (error: string, status: number) => { await refund(); return json({ error, refunded: true }, status); };
  try {
    if (kind === "profile") {
      const { data: docs } = await admin.from("user_docs").select("kind,title,content").eq("user_id", user.id).order("created_at");
      const text = (docs ?? []).map((d) => `### ${d.kind}${d.title ? ": " + d.title : ""}\n${d.content}`).join("\n\n").slice(0, 40000);
      const summary = (await llm(PROFILE_SYSTEM, text, 500)).trim();
      if (!summary) return await fail("Profile came back empty; you weren't charged. Try again.", 502);
      await admin.from("profiles").update({ profile_summary: summary, profile_updated_at: new Date().toISOString() }).eq("id", user.id);
      return json({ profile_summary: summary, credits_cents: balance });
    }

    const name = String(body.author_name).trim().slice(0, 200);
    const papers = await recentPapers(name, body.institution);
    if (!papers.length) return await fail("Couldn't find recent papers for this professor on OpenAlex; you weren't charged.", 404);
    const prompt = `STUDENT PROFILE:\n${prof!.profile_summary}\n\nPROFESSOR: ${name}${body.institution ? " (" + body.institution + ")" : ""}\n\nPROFESSOR'S RECENT PAPERS:\n`
      + papers.map((p: any, i: number) => `${i + 1}. ${p.title} (${p.year})${p.abstract ? "\n   Abstract: " + p.abstract : ""}`).join("\n");
    let out = parseEmail(await llm(EMAIL_SYSTEM, prompt));
    const bad = hasBanned(out.subject + " " + out.body);
    if (bad.length) out = parseEmail(await llm(EMAIL_SYSTEM, prompt + `\n\nYour last draft used banned phrases (${bad.join(", ")}). Rewrite without them.`));
    if (!out.subject || !out.body) return await fail("Draft came back malformed; you weren't charged. Try again.", 502);
    const { data: row } = await admin.from("drafts").insert({ user_id: user.id, author_name: name, subject: out.subject, body: out.body, papers }).select().single();
    return json({ ...row, credits_cents: balance });
  } catch (e) {
    return await fail((e as Error).message + " (you weren't charged)", 500);
  }
});
