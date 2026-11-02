// Supabase Edge Function: POST /functions/v1/draft
// Body: { action: "profile" }                  -> rebuilds profiles.profile_summary from user_docs
//       { action: "email", author_name, institution? } -> drafts one email to that professor
// Auth: the caller's Supabase JWT. All writes use the service role after verifying the user.
// LLM: uses ANTHROPIC_API_KEY if set, else GEMINI_API_KEY. Neither is ever sent to the browser.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { cached, oaJson, OpenAlexLimited } from "../_shared/openalex.ts";
import { enforceDraftRules, isMismatch, looksLikeResume, misstatesStage } from "./rules.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Prices in cents. Plan = $10/month buys 1000 cents. Raw model cost per draft is ~0.05 cent with
// Haiku 5.5 ($0.10/$0.50 per M tokens); the margin covers Stripe fees, OpenAlex lookups and failed generations.
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
  let lastErr = "";
  if (ak) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ak, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      // Haiku 5.5 thinks by default, which can spend the whole token budget before any text.
      body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-5-5", max_tokens: maxTokens, thinking: { type: "disabled" }, system, messages: [{ role: "user", content: user }] }),
    });
    const d = await r.json();
    if (r.ok) return d.content.map((c: { text?: string }) => c.text ?? "").join("");
    lastErr = d.error?.message ?? String(r.status);
    if (!gk) throw new Error("LLM error: " + lastErr);
    console.error("Anthropic failed, falling back to Gemini:", lastErr);
  }
  if (gk) {
    // 2.5 Flash often returns 503 "high demand"; fall back to Flash-Lite before giving up.
    for (const model of ["gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gk}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } } }),
      });
      const d = await r.json();
      if (r.ok) return d.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      lastErr = d.error?.message ?? String(r.status);
      if (r.status !== 503 && r.status !== 429) break;
    }
    throw new Error("LLM error: " + lastErr);
  }
  throw new Error("NO_LLM_KEY");
}

// Streaming variant for the email draft: calls onText with each chunk as it arrives so the student
// sees words in about a second. Anthropic streams over SSE; Gemini falls back to one chunk.
async function llmStream(system: string, user: string, onText: (t: string) => void, maxTokens = 700): Promise<string> {
  const ak = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ak) { const t = await llm(system, user, maxTokens); onText(t); return t; }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ak, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-5-5", max_tokens: maxTokens, stream: true, thinking: { type: "disabled" }, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok || !r.body) { const t = await llm(system, user, maxTokens); onText(t); return t; } // llm() handles Gemini fallback
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "", out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      let ev: any;
      try { ev = JSON.parse(line.slice(5)); } catch { continue; } // keep-alive / partial line
      if (ev.type === "content_block_delta" && ev.delta?.text) { out += ev.delta.text; onText(ev.delta.text); }
      // Mid-stream failure (e.g. overloaded): redo it non-streaming (llm() falls back to Gemini).
      // The browser's preview is replaced by the final {done} draft anyway.
      if (ev.type === "error") return await llm(system, user, maxTokens);
    }
  }
  return out;
}

// Rebuild an abstract from OpenAlex's inverted index.
function abstractOf(inv: Record<string, number[]> | null): string {
  if (!inv) return "";
  const words: string[] = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.join(" ").slice(0, 600);
}

export async function recentPapers(name: string, institution?: string, openalexId?: string) {
  // Prefer the exact OpenAlex id saved from the finder/professor page; name search can pick a namesake.
  let id = openalexId && /^A\d{4,12}$/.test(openalexId) ? openalexId : null;
  if (!id) {
    // Name -> author id is stable; cache it so drafts for rankings-saved professors skip a search call.
    id = await cached(`authorid:${name.toLowerCase()}|${institution ?? ""}`, 24 * 30, async () => {
      const a = await oaJson(`authors?search=${encodeURIComponent(name)}&per-page=5&select=id,display_name,last_known_institutions,works_count`);
      let cand = a?.results ?? [];
      if (institution) {
        const hit = cand.find((c: any) => (c.last_known_institutions ?? []).some((i: any) => i.display_name === institution));
        if (hit) cand = [hit];
      }
      return cand[0] ? cand[0].id.split("/").pop() : null;
    });
    if (!id) return [];
  }
  return await cached(`papers:${id}`, 24 * 7, async () => {
    const w = await oaJson(`works?filter=author.id:${id},type:article&sort=publication_date:desc&per-page=4&select=title,publication_year,abstract_inverted_index,doi`);
    return (w?.results ?? []).map((x: any) => ({ title: x.title, year: x.publication_year, doi: x.doi, abstract: abstractOf(x.abstract_inverted_index) }));
  });
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
- Second: name ONE specific paper of the professor's from the list given, quoting its exact title in double quotes, and state a concrete connection to the student's own work or a specific question about it. Do not summarize the paper back to them.
- Then: one sentence with the most relevant evidence the student can contribute (a skill or result from the profile).
- Then: a specific, small ask (e.g. "Would you be open to a 15-minute call?" or "Are you taking students for the summer?"). One ask only.
- Sign off with the student's full name from STUDENT NAME on its own line (use [Your name] only if it is unknown).
- Describe the student's stage exactly as the profile states it (e.g. high school senior). Never call a high school student an undergrad.
- Never write that a paper is outside the student's area, unrelated to their work, or a stretch. Pick the paper from the list closest to the student's own work and connect to that one.
- Open with "Dear Professor <last name>," on its own line.
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

  const { data: prof } = await admin.from("profiles").select("profile_summary, credits_cents, birth_year, display_name").eq("id", user.id).single();
  // COPPA: the server role bypasses row-level rules, so check age here too.
  if (!prof?.birth_year || prof.birth_year > new Date().getFullYear() - 13) {
    return json({ error: "You need to be 13 or older to use this.", age: true }, 403);
  }
  const kind = body.action === "profile" ? "profile" : body.action === "email" ? "email" : null;
  if (!kind) return json({ error: "Unknown action" }, 400);

  // Cheap validation before charging anything.
  if (kind === "profile") {
    const { data: docs } = await admin.from("user_docs").select("content").eq("user_id", user.id);
    if (!docs?.length) return json({ error: "Add your resume, bio or past work first." }, 400);
    if (!looksLikeResume(docs.map((d) => d.content).join("\n"))) {
      return json({ error: "That doesn't look like a resume yet. Add a few sentences about your school, skills and projects. You weren't charged." }, 400);
    }
  } else {
    if (!String(body.author_name ?? "").trim()) return json({ error: "author_name required" }, 400);
    // Paper lookups hit the shared OpenAlex budget even when free (prefetch) or refunded (failed draft),
    // so cap them per user. Prefetch + draft count twice per professor; 200/day is far above real use.
    const { data: oaOk } = await admin.rpc("take_search", { p_who: "oa:" + user.id, p_limit: 200 });
    if (oaOk === false) return json({ error: "You've hit today's limit for professor lookups. It resets at midnight UTC.", quota: true }, 429);
    // Warm-up: fetch + cache the professor's papers when their row opens, so the later Draft click skips
    // the OpenAlex round trip. Free (handled before any charge); uses the same cache as drafting.
    if (body.prefetch) {
      await recentPapers(String(body.author_name).trim().slice(0, 200), body.institution, body.openalex_id).catch(() => {});
      return json({ ok: true });
    }
    if (!prof?.profile_summary) return json({ error: "Build your profile first." }, 400);
    // Mismatch guard (before charging): if the professor's recent work doesn't overlap the student's
    // profile, don't draft a bridge email to an unrelated lab. Papers are already cached by prefetch,
    // so this lookup is free. body.force === true skips the guard ("Draft anyway").
    if (body.force !== true) {
      const name = String(body.author_name).trim().slice(0, 200);
      const papers = await recentPapers(name, body.institution, body.openalex_id).catch(() => []);
      if (papers.length) {
        const m = isMismatch(prof.profile_summary, papers);
        if (m.mismatch) {
          return json({ mismatch: true, reason: "This lab's recent work doesn't look related to your profile.", papers: papers.map((p: any) => p.title).filter(Boolean) });
        }
      }
    }
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
    const papers = await recentPapers(name, body.institution, body.openalex_id);
    if (!papers.length) return await fail("Couldn't find recent papers for this professor on OpenAlex; you weren't charged.", 404);
    const student = String(prof!.display_name ?? "").trim();
    const prompt = `STUDENT NAME: ${student || "(unknown)"}\nSTUDENT AGE: about ${new Date().getFullYear() - prof!.birth_year}\n\nSTUDENT PROFILE:\n${prof!.profile_summary}\n\nPROFESSOR: ${name}${body.institution ? " (" + body.institution + ")" : ""}\n\nPROFESSOR'S RECENT PAPERS:\n`
      + papers.map((p: any, i: number) => `${i + 1}. ${p.title} (${p.year})${p.abstract ? "\n   Abstract: " + p.abstract : ""}`).join("\n");
    // Stream the first draft to the browser as newline-delimited JSON: {t:"chunk"}... then the final
    // {done:{...row}} (after banned-phrase / stage checks, which may replace the streamed text).
    if (body.stream) {
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(ctl) {
          // If the browser disconnects, enqueue throws; swallow so the refund path still runs cleanly.
          const send = (o: unknown) => { try { ctl.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* closed */ } };
          try {
            let raw = await llmStream(EMAIL_SYSTEM, prompt, (t) => send({ t }));
            let out = parseEmail(raw);
            const bad = hasBanned(out.subject + " " + out.body);
            if (bad.length) { send({ rewriting: true }); out = parseEmail(raw = await llm(EMAIL_SYSTEM, prompt + `\n\nYour last draft used banned phrases (${bad.join(", ")}). Rewrite without them.`)); }
            if (misstatesStage(out, prof!.profile_summary ?? "")) {
              send({ rewriting: true });
              const retry = parseEmail(await llm(EMAIL_SYSTEM, prompt + `\n\nYour last draft called the student an undergraduate. They are in high school. Rewrite it describing them as a high school student.`));
              if (retry.subject && retry.body) out = retry;
            }
            if (!out.subject || !out.body) { await refund(); send({ error: "Draft came back malformed; you weren't charged. Try again." }); ctl.close(); return; }
            out = enforceDraftRules(out, name, prof!.profile_summary ?? "");
            const { data: row, error: insErr } = await admin.from("drafts").insert({ user_id: user.id, author_name: name, subject: out.subject, body: out.body, papers }).select().single();
            if (insErr || !row) { await refund(); send({ error: "Couldn't save the draft; you weren't charged. Try again." }); ctl.close(); return; }
            send({ done: { ...row, credits_cents: balance } });
          } catch (e) { await refund(); send({ error: (e as Error).message + " (you weren't charged)" }); }
          ctl.close();
        },
      });
      return new Response(stream, { headers: { ...CORS, "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
    }
    let raw = await llm(EMAIL_SYSTEM, prompt);
    let out = parseEmail(raw);
    const bad = hasBanned(out.subject + " " + out.body);
    if (bad.length) out = parseEmail(raw = await llm(EMAIL_SYSTEM, prompt + `\n\nYour last draft used banned phrases (${bad.join(", ")}). Rewrite without them.`));
    if (misstatesStage(out, prof!.profile_summary ?? "")) {
      const retry = parseEmail(await llm(EMAIL_SYSTEM, prompt + `\n\nYour last draft called the student an undergraduate. They are in high school. Rewrite it describing them as a high school student.`));
      if (retry.subject && retry.body) out = retry;
    }
    if (!out.subject || !out.body) { console.error("malformed draft:", raw.slice(0, 500)); return await fail("Draft came back malformed; you weren't charged. Try again.", 502); }
    out = enforceDraftRules(out, name, prof!.profile_summary ?? "");
    const { data: row, error: insErr } = await admin.from("drafts").insert({ user_id: user.id, author_name: name, subject: out.subject, body: out.body, papers }).select().single();
    if (insErr || !row) return await fail("Couldn't save the draft; you weren't charged. Try again.", 502);
    return json({ ...row, credits_cents: balance });
  } catch (e) {
    if (e instanceof OpenAlexLimited) return await fail(e.message + " You weren't charged.", 503);
    return await fail((e as Error).message + " (you weren't charged)", 500);
  }
});
