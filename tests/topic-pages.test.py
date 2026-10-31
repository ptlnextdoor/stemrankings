#!/usr/bin/env python3
# Verify generated topic pages with system Chrome via Playwright.
# Serve the repo root first:  python3 -m http.server 8099
# Then:  BASE=http://localhost:8099 python3 tests/topic-pages.test.py
import os, random, sys, json, re
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8099")
topics = [d for d in os.listdir("topics") if os.path.isdir(os.path.join("topics", d))]
pick = random.sample(topics, 3)

bad = [0]
# Browsers auto-request /favicon.ico; a 404 for it is unrelated to page correctness.
def note(m, errs):
    t = m.text.lower()
    if m.type == "error" and "favicon" not in t and "failed to load resource" not in t:
        errs.append(m.text)
def ok(c, m):
    print(("ok   " if c else "FAIL ") + m)
    if not c: bad[0] = 1

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    ctx = browser.new_context()

    for slug in pick:
        page = ctx.new_page()
        errs = []
        page.on("console", lambda m: note(m, errs))
        page.on("pageerror", lambda e: errs.append(str(e)))
        resp = page.goto(f"{BASE}/topics/{slug}/", wait_until="networkidle")
        ok(resp.ok, f"{slug}: HTTP {resp.status}")
        labs = page.locator(".topic-lab").count()
        ok(labs == 25, f"{slug}: {labs} labs render (expect 25)")
        ctas = page.locator("a.tl-cta").count()
        ok(ctas == 25, f"{slug}: {ctas} CTA deep links")
        h1 = page.locator("h1").first.text_content()
        ok("take students" in h1, f"{slug}: H1 ok")
        ok(len(errs) == 0, f"{slug}: no console errors {json.dumps(errs[:2]) if errs else ''}")
        page.close()

    # Deep-link: take first lab CTA, rewrite host to local, confirm finder + panel.
    slug = pick[0]
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: note(m, errs))
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(f"{BASE}/topics/{slug}/", wait_until="networkidle")
    href = page.locator("a.tl-cta").first.get_attribute("href")
    local = re.sub(r"^https://needalab\.com", BASE, href)
    print("deep link ->", local)
    page.goto(local, wait_until="domcontentloaded")
    got = True
    try: page.locator(".prof-card").first.wait_for(timeout=30000)
    except Exception: got = False
    ok(got, "deep link auto-runs finder (prof cards shown)")
    ok(len(page.locator("#find-q").input_value()) >= 3, "deep link prefilled finder query")
    panel = True
    try: page.locator("#prof-panel.open").wait_for(timeout=30000)
    except Exception: panel = False
    ok(panel, "deep link opens professor panel")
    ok(len(errs) == 0, f"deep link page: no console errors {json.dumps(errs[:3]) if errs else ''}")
    page.close()
    browser.close()

print("\nRESULT:", "FAIL" if bad[0] else "PASS")
sys.exit(bad[0])
