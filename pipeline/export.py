#!/usr/bin/env python3
"""
Regenerate the site CSVs FROM our research store so the frontend keeps working unchanged.

Reads people / institutions / person_area_year from the Supabase REST API and writes the
same three files and columns the browser parses:
  data/generated-author-info.csv : name,dept,area,count,adjustedcount,year
  data/authors.csv               : name,affiliation,homepage,scholarid,orcid
  data/institutions.csv          : institution,region,countryabbrv,homepage

The frontend keys authors by display NAME, so we collapse our author-id rows to name here
(this is the only place namesakes merge; the store itself stays id-keyed). Safety guard:
if the regenerated generated-author-info.csv has fewer than (1 - threshold) of the current
file's rows, we refuse to overwrite and print a report instead, so a broken or partial pull
can never wipe the live site. Pass --force to override, --check to only report.

Needs the Supabase key in env SR (service or anon; read-only here). Python stdlib only.
"""
import argparse, csv, json, os, sys, urllib.parse, urllib.request, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
REST = "https://oxcnlommtnziwfbpxigd.supabase.co/rest/v1"
SR = os.environ.get("SR")
if not SR:
    sys.exit("set SR to a Supabase key (service or anon; read-only)")


def fetch_all(table, select):
    """Page through a table with range headers (PostgREST caps at 1000/response)."""
    out, step, offset = [], 1000, 0
    while True:
        url = f"{REST}/{table}?select={urllib.parse.quote(select)}"
        req = urllib.request.Request(url, headers={
            "apikey": SR, "Authorization": f"Bearer {SR}",
            "Range-Unit": "items", "Range": f"{offset}-{offset + step - 1}",
        })
        with urllib.request.urlopen(req, timeout=120) as r:
            rows = json.load(r)
        out.extend(rows)
        if len(rows) < step:
            break
        offset += step
    return out


def csv_rows(path):
    if not path.exists():
        return 0
    with open(path) as f:
        return sum(1 for _ in f) - 1


def build():
    insts = {i["id"]: i for i in fetch_all("institutions", "id,name,region,country_code,homepage")}
    people = {p["id"]: p for p in fetch_all("people", "id,name,orcid,institution_id,homepage")}
    pay = fetch_all("person_area_year", "person_id,area_id,year,papers,adj,senior")

    # generated-author-info rows, collapsed by (name, dept, area, year)
    agg = collections.defaultdict(lambda: {"count": 0, "adj": 0.0})
    author_dept = {}
    for row in pay:
        p = people.get(row["person_id"])
        if not p:
            continue
        name = p["name"]
        inst = insts.get(p["institution_id"]) if p["institution_id"] else None
        dept = inst["name"] if inst else ""
        if not dept:
            continue
        author_dept[name] = dept
        key = (name, dept, row["area_id"], row["year"])
        cell = agg[key]
        cell["count"] += row["papers"]
        cell["adj"] += row["adj"]

    gen = [["name", "dept", "area", "count", "adjustedcount", "year"]]
    for (name, dept, area, year), v in agg.items():
        gen.append([name, dept, area, f"{v['count']}.0", f"{v['adj']:.5f}", year])

    authors = [["name", "affiliation", "homepage", "scholarid", "orcid"]]
    seen = set()
    for p in people.values():
        name = p["name"]
        if name in seen or name not in author_dept:
            continue
        seen.add(name)
        authors.append([name, author_dept[name], p.get("homepage") or "", "",
                        p.get("orcid") or "0000-0000-0000-0000"])

    inst_rows = [["institution", "region", "countryabbrv", "homepage"]]
    used = {d for d in author_dept.values()}
    done = set()
    for i in insts.values():
        if i["name"] in used and i["name"] not in done:
            done.add(i["name"])
            inst_rows.append([i["name"], i.get("region") or "world",
                              (i.get("country_code") or ""), i.get("homepage") or ""])
    return gen, authors, inst_rows


def write_csv(path, rows):
    with open(path, "w", newline="") as f:
        csv.writer(f).writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=0.20,
                    help="max allowed shrink vs current CSV before refusing (default 20%)")
    ap.add_argument("--force", action="store_true", help="overwrite even if the guard trips")
    ap.add_argument("--check", action="store_true", help="report only, write nothing")
    args = ap.parse_args()

    gen, authors, inst_rows = build()
    new_n = len(gen) - 1
    old_n = csv_rows(DATA / "generated-author-info.csv")
    floor = int(old_n * (1 - args.threshold))
    sys.stderr.write(f"generated-author-info: new={new_n} rows, current={old_n}, floor={floor}\n")
    sys.stderr.write(f"authors={len(authors)-1} institutions={len(inst_rows)-1}\n")

    if args.check:
        sys.stderr.write("check only, nothing written\n")
        return
    if new_n < floor and not args.force:
        sys.stderr.write("GUARD: regenerated data is too small vs current CSVs; refusing to overwrite.\n"
                         "Run with --force if this shrink is expected.\n")
        sys.exit(2)

    write_csv(DATA / "generated-author-info.csv", gen)
    write_csv(DATA / "authors.csv", authors)
    write_csv(DATA / "institutions.csv", inst_rows)
    sys.stderr.write("wrote 3 CSVs\n")


if __name__ == "__main__":
    main()
