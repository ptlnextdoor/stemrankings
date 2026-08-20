#!/usr/bin/env python3
"""
STEMRankings data pipeline.

Generalizes CSRankings from CS-only (DBLP) to ALL STEM fields (OpenAlex).

For each area in data/areas.json we query OpenAlex for recent works, then
credit each author using CSRankings' "adjusted count" scheme: a paper with k
authors gives each author 1/k credit (CSRankings uses 1/k of a full paper so
that a single paper cannot be counted many times). Author affiliation comes
from the OpenAlex institution on that authorship.

Outputs (schemas identical to CSRankings so the frontend is a faithful clone):
  data/generated-author-info.csv : name,dept,area,count,adjustedcount,year
  data/authors.csv               : name,affiliation,homepage,scholarid,orcid
  data/institutions.csv          : institution,region,countryabbrv,homepage

Usage:
  python3 pipeline/build.py --per-area 400        # quick demo
  python3 pipeline/build.py --per-area 2000        # fuller run
"""
import argparse, csv, json, os, sys, time, urllib.parse, urllib.request, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OPENALEX = "https://api.openalex.org"
# Polite pool: identify ourselves so OpenAlex gives us the fast lane.
MAILTO = os.environ.get("OPENALEX_MAILTO", "stemrankings@example.org")

# OpenAlex continent -> CSRankings region bucket
REGION_OF_CONTINENT = {
    "Europe": "europe", "North America": "northamerica", "South America": "southamerica",
    "Oceania": "australasia", "Asia": "asia", "Africa": "africa",
}

def http_get(url, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "STEMRankings/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if attempt == tries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    return None

def area_filter(area):
    """Return the OpenAlex filter fragment selecting works for this area."""
    if "subfield" in area:
        return f"primary_topic.subfield.id:subfields/{area['subfield']}"
    if "search" in area:
        return None  # search handled separately via &search=
    raise ValueError(f"area {area['id']} has no subfield/search")

def fetch_area_works(area, per_area, from_year):
    """Yield work dicts for an area, newest-cited first, capped at per_area."""
    base_filter = f"from_publication_date:{from_year}-01-01,type:article"
    af = area_filter(area)
    params = {
        "per-page": "200",
        "select": "id,title,publication_year,authorships,cited_by_count",
        "sort": "cited_by_count:desc",
        "mailto": MAILTO,
    }
    if af:
        params["filter"] = f"{base_filter},{af}"
    else:
        params["filter"] = base_filter
        params["search"] = area["search"]
    got = 0
    cursor = "*"
    while got < per_area:
        p = dict(params, cursor=cursor)
        url = f"{OPENALEX}/works?{urllib.parse.urlencode(p)}"
        data = http_get(url)
        if not data:
            break
        results = data.get("results", [])
        if not results:
            break
        for w in results:
            yield w
            got += 1
            if got >= per_area:
                break
        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break
        time.sleep(0.12)

def pick_institution(authorship):
    insts = authorship.get("institutions") or []
    for i in insts:
        if i.get("display_name"):
            return i
    return None

def run(per_area, from_year, max_authors_per_paper):
    areas_cfg = json.loads((DATA / "areas.json").read_text())
    # name -> {area: {year: adjcount}}, and raw counts
    author_area_year = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(float)))
    author_area_year_raw = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(int)))
    author_dept = {}           # name -> institution display name
    author_meta = {}           # name -> {orcid, homepage}
    inst_info = {}             # institution -> (region, countryabbrv)

    all_areas = [a for d in areas_cfg["divisions"] for a in d["areas"]]
    for idx, area in enumerate(all_areas):
        aid = area["id"]
        sys.stderr.write(f"[{idx+1}/{len(all_areas)}] {aid:10} {area['title']}... ")
        sys.stderr.flush()
        n_works = 0
        for w in fetch_area_works(area, per_area, from_year):
            year = w.get("publication_year")
            if not year:
                continue
            auths = w.get("authorships") or []
            k = len(auths)
            if k == 0 or k > max_authors_per_paper:
                continue
            adj = 1.0 / k   # CSRankings-style: split one paper's credit among authors
            for a in auths:
                inst = pick_institution(a)
                if not inst:
                    continue
                dept = inst["display_name"]
                name = a["author"].get("display_name")
                if not name:
                    continue
                author_area_year[name][aid][year] += adj
                author_area_year_raw[name][aid][year] += 1
                author_dept[name] = dept
                if name not in author_meta:
                    orcid = (a["author"].get("orcid") or "").replace("https://orcid.org/", "")
                    author_meta[name] = {"orcid": orcid, "homepage": ""}
                if dept not in inst_info:
                    # Country comes from the INSTITUTION itself, not the paper's
                    # first author (which gave wrong flags, e.g. Cambridge->cn).
                    cc = (inst.get("country_code") or "").lower()
                    inst_info[dept] = {"countryabbrv": cc, "ror": inst.get("ror", "")}
            n_works += 1
        sys.stderr.write(f"{n_works} works\n")

    # ---- write generated-author-info.csv ----
    DATA.mkdir(exist_ok=True)
    with open(DATA / "generated-author-info.csv", "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["name", "dept", "area", "count", "adjustedcount", "year"])
        for name, areas in author_area_year.items():
            dept = author_dept.get(name, "")
            for aid, years in areas.items():
                for year, adj in years.items():
                    raw = author_area_year_raw[name][aid][year]
                    wr.writerow([name, dept, aid, f"{raw}.0", f"{adj:.5f}", year])

    # ---- write authors.csv ----
    with open(DATA / "authors.csv", "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["name", "affiliation", "homepage", "scholarid", "orcid"])
        for name, meta in author_meta.items():
            wr.writerow([name, author_dept.get(name, ""), meta["homepage"], "", meta["orcid"] or "0000-0000-0000-0000"])

    # ---- write institutions.csv (region resolved via country) ----
    from country_regions import COUNTRY_REGION
    with open(DATA / "institutions.csv", "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["institution", "region", "countryabbrv", "homepage"])
        for inst, info in inst_info.items():
            cc = info["countryabbrv"]
            region = COUNTRY_REGION.get(cc, "world")
            wr.writerow([inst, region, cc, ""])

    sys.stderr.write(f"\nDone. authors={len(author_meta)} institutions={len(inst_info)}\n")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-area", type=int, default=400)
    ap.add_argument("--from-year", type=int, default=2015)
    ap.add_argument("--max-authors", type=int, default=30,
                    help="skip mega-author papers (consortia) above this many authors")
    args = ap.parse_args()
    run(args.per_area, args.from_year, args.max_authors)
