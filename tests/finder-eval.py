#!/usr/bin/env python3
"""Outcome eval for the professor finder (no keys needed; uses the public anon key from js/account.js).

For each research topic, take the finder's top 10 US professors and check against OpenAlex directly:
  relevant = the professor has >= 2 of their OWN papers since 2023 matching the topic.
Also counts how many of those professors appear anywhere in the original site's faculty table
(data/authors.csv), i.e. whether the original institution-ranking view could have surfaced them.
Exits 1 if precision@10 drops below 0.85.
Run: python3 tests/finder-eval.py
"""
import json, urllib.request, urllib.parse, urllib.error, csv, sys, os, time
root = os.path.join(os.path.dirname(__file__), "..")
ANON = open(os.path.join(root, "js/account.js")).read().split('SUPABASE_ANON_KEY = "')[1].split('"')[0]
QUERIES = ["EEG brain computer interface", "cold plasma wound healing", "phage therapy antibiotic resistance",
           "soft robotics actuators", "CRISPR base editing", "perovskite solar cells"]

def fetch_json(req, tries=6):
    # OpenAlex rate-limits bursts (HTTP 429). Back off and retry instead of crashing the eval.
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503) or i == tries - 1: raise
            time.sleep(2 ** i)
def post(fn, body):
    return fetch_json(urllib.request.Request(f"https://oxcnlommtnziwfbpxigd.supabase.co/functions/v1/{fn}", data=json.dumps(body).encode(),
                                             headers={"apikey": ANON, "Content-Type": "application/json"}))
def oa(path):
    time.sleep(0.15)  # stay well under OpenAlex's polite-pool rate
    # Judge costs ~60 search calls ($0.06). Keyless budget is $0.10/day per IP, so set OPENALEX_API_KEY.
    key = os.environ.get("OPENALEX_API_KEY")
    return fetch_json("https://api.openalex.org/" + path + "&mailto=stemrankings@kahlus.com" + (f"&api_key={key}" if key else ""))
names = {r["name"] for r in csv.DictReader(open(os.path.join(root, "data/authors.csv")))}
rel_total = old_total = n = 0
for q in QUERIES:
    top = post("find", {"query": q, "country": "US"})["professors"][:10]
    rel = sum(oa(f"works?filter=author.id:{p['id']},from_publication_date:2023-01-01&search={urllib.parse.quote(q)}&per-page=1")["meta"]["count"] >= 2 for p in top)
    old = sum(p["name"] in names for p in top)
    rel_total += rel; old_total += old; n += len(top)
    print(f"{q[:38]:38} relevant {rel}/{len(top)}  in original table {old}/{len(top)}")
prec = rel_total / n
print(f"precision@10 {rel_total}/{n} = {prec:.2f}; findable in original site {old_total}/{n}")
sys.exit(0 if prec >= 0.85 else 1)
