// Shared OpenAlex access for all Edge Functions.
// Since Feb 2026 OpenAlex meters usage: keyless callers get ~$0.10/day (shared per IP, so the whole
// site), a free key gets $1/day (~1,000 searches + 10,000 list calls). Set OPENALEX_API_KEY to use it.
// Results are cached in public.openalex_cache so repeat searches and professor pages cost nothing.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export class OpenAlexLimited extends Error {
  constructor() { super("Professor search is temporarily at capacity. Try again in a few hours."); }
}

export function oaUrl(path: string): string {
  const key = Deno.env.get("OPENALEX_API_KEY");
  const sep = path.includes("?") ? "&" : "?";
  return `https://api.openalex.org/${path}${sep}mailto=stemrankings@kahlus.com${key ? `&api_key=${encodeURIComponent(key)}` : ""}`;
}

export async function oaJson(path: string): Promise<any> {
  const r = await fetch(oaUrl(path));
  if (r.status === 429) throw new OpenAlexLimited();
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`OpenAlex error ${r.status}`);
  return await r.json();
}

let admin: SupabaseClient | null = null;
export const db = () => (admin ??= createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));

// Cache any OpenAlex-derived JSON for `ttlHours`. Cache failures never break the request.
export async function cached<T>(key: string, ttlHours: number, produce: () => Promise<T>): Promise<T> {
  try {
    const { data } = await db().from("openalex_cache").select("body, fetched_at").eq("key", key).maybeSingle();
    if (data && Date.now() - new Date(data.fetched_at).getTime() < ttlHours * 3600_000) return data.body as T;
  } catch { /* fall through to live fetch */ }
  const body = await produce();
  try { await db().from("openalex_cache").upsert({ key, body, fetched_at: new Date().toISOString() }); } catch { /* ignore */ }
  return body;
}
