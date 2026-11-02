#!/usr/bin/env python3
"""
needalab research-store ingest.

Pulls recent OpenAlex works per area (data/areas.json) and writes aggregates into
OUR database: institutions, people, venues, person_area_year, areas. People are keyed
by OpenAlex AUTHOR ID (not display name) so namesakes stay separate. Each paper with k
authors credits every author 1/k (CSRankings adjusted-count scheme); last-author papers
are counted as "senior". Everything here is CC0 OpenAlex data, re-running is idempotent
(upsert on primary key), and the run is logged in data_runs.

Needs the Supabase service key in env SR (never printed). Python stdlib only, like build.py.

Usage:
  SR=<service key> python3 pipeline/ingest.py --per-area 600
  SR=<service key> python3 pipeline/ingest.py --per-area 2000 --from-year 2016
"""
import argparse, json, os, sys, time, urllib.parse, urllib.request, collections, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import http_get, OPENALEX  # reuse polite retrying GET
from country_regions import COUNTRY_REGION

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PROJECT_REF = "oxcnlommtnziwfbpxigd"
REST = f"https://{PROJECT_REF}.supabase.co/rest/v1"
MAILTO = os.environ.get("OPENALEX_MAILTO", "stemrankings@kahlus.com")

SR = os.environ.get("SR")
if not SR:
    sys.exit("set SR to the Supabase service key (never printed)")


def rest(table, rows, on_conflict=None):
    """Upsert rows into a table via the Supabase REST API, in batches."""
    if not rows:
        return
    params = {}
    if on_conflict:
        params["on_conflict"] = on_conflict
    url = f"{REST}/{table}" + ("?" + urllib.parse.urlencode(params) if params else "")
    headers = {
        "apikey": SR,
        "Authorization": f"Bearer {SR}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        body = json.dumps(batch).encode()
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    r.read()
                break
            except urllib.error.HTTPError as e:
                msg = e.read().decode()[:300]
                if attempt == 3:
                    raise RuntimeError(f"{table} upsert failed: {e.code} {msg}")
                time.sleep(1.5 * (attempt + 1))
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(1.5 * (attempt + 1))
        time.sleep(0.05)


def data_run(source, rows=None, notes=None, started=None):
    """Insert or finalize a data_runs row. Returns the row id."""
    if started is None:
        payload = [{"source": source, "notes": notes}]
        url = f"{REST}/data_runs?select=id"
        headers = {
            "apikey": SR, "Authorization": f"Bearer {SR}",
            "Content-Type": "application/json", "Prefer": "return=representation",
        }
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)[0]["id"]
    # finalize
    url = f"{REST}/data_runs?id=eq.{started}"
    headers = {"apikey": SR, "Authorization": f"Bearer {SR}",
               "Content-Type": "application/json", "Prefer": "return=minimal"}
    body = json.dumps({"finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       "rows": rows, "notes": notes}).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()


def short_id(openalex_url):
    """https://openalex.org/A123 -> A123"""
    if not openalex_url:
        return None
    return openalex_url.rstrip("/").rsplit("/", 1)[-1]


def fetch_area_works(area, per_area, from_date):
    af = None
    if "subfield" in area:
        af = f"primary_topic.subfield.id:subfields/{area['subfield']}"
    base = f"from_publication_date:{from_date},type:article|proceedings-article"
    params = {
        "per-page": "200",
        "select": "id,publication_year,authorships,primary_location,cited_by_count",
        "sort": "cited_by_count:desc",
        "mailto": MAILTO,
    }
    if af:
        params["filter"] = f"{base},{af}"
    else:
        params["filter"] = base
        params["search"] = area["search"]
    got, cursor = 0, "*"
    while got < per_area:
        p = dict(params, cursor=cursor)
        data = http_get(f"{OPENALEX}/works?{urllib.parse.urlencode(p)}")
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
        time.sleep(0.1)  # ~10 req/s ceiling


def pick_institution(authorship):
    for i in (authorship.get("institutions") or []):
        if i.get("id") and i.get("display_name"):
            return i
    return None


def run(per_area, from_year, max_authors):
    areas_cfg = json.loads((DATA / "areas.json").read_text())
    all_areas = []
    area_rows = []
    for d in areas_cfg["divisions"]:
        for a in d["areas"]:
            all_areas.append(a)
            area_rows.append({"id": a["id"], "title": a["title"],
                              "division": d["id"], "subfield": a.get("subfield")})

    from_date = f"{from_year}-01-01"
    started = data_run("openalex", notes=f"per_area={per_area} from={from_date}")

    institutions = {}   # Iid -> row
    people = {}         # Aid -> row
    venues = {}         # Sid -> row
    pay = collections.defaultdict(lambda: {"papers": 0, "adj": 0.0, "senior": 0})  # (Aid,area,year)

    for idx, area in enumerate(all_areas):
        aid = area["id"]
        sys.stderr.write(f"[{idx+1}/{len(all_areas)}] {aid:10} {area['title']}... ")
        sys.stderr.flush()
        n = 0
        for w in fetch_area_works(area, per_area, from_date):
            year = w.get("publication_year")
            if not year:
                continue
            auths = w.get("authorships") or []
            k = len(auths)
            if k == 0 or k > max_authors:
                continue
            adj = 1.0 / k
            # venue
            src = (w.get("primary_location") or {}).get("source") or {}
            sid = short_id(src.get("id"))
            if sid and sid.startswith("S") and sid not in venues:
                venues[sid] = {"id": sid, "name": src.get("display_name") or sid,
                               "type": src.get("type"), "area_id": aid,
                               "issn_l": src.get("issn_l")}
            for a in auths:
                pid = short_id(a.get("author", {}).get("id"))
                if not pid or not pid.startswith("A"):
                    continue
                name = a.get("author", {}).get("display_name")
                if not name:
                    continue
                inst = pick_institution(a)
                inst_id = short_id(inst.get("id")) if inst else None
                if inst and inst_id and inst_id not in institutions:
                    cc = (inst.get("country_code") or "").lower()
                    institutions[inst_id] = {
                        "id": inst_id, "name": inst["display_name"],
                        "country_code": cc or None,
                        "region": COUNTRY_REGION.get(cc, "world"),
                        "ror": inst.get("ror"), "type": inst.get("type"), "homepage": None,
                    }
                # person: keep most-recent institution and name
                p = people.get(pid)
                orcid = (a.get("author", {}).get("orcid") or "").replace("https://orcid.org/", "") or None
                if not p:
                    people[pid] = {"id": pid, "name": name, "orcid": orcid,
                                   "institution_id": inst_id, "homepage": None,
                                   "dblp_pid": None, "last_seen_year": year, "works_count": 0}
                    p = people[pid]
                else:
                    if year >= (p["last_seen_year"] or 0):
                        p["last_seen_year"] = year
                        if inst_id:
                            p["institution_id"] = inst_id
                        p["name"] = name
                    if orcid and not p["orcid"]:
                        p["orcid"] = orcid
                p["works_count"] += 1
                key = (pid, aid, year)
                cell = pay[key]
                cell["papers"] += 1
                cell["adj"] += adj
                if a.get("author_position") == "last":
                    cell["senior"] += 1
            n += 1
        sys.stderr.write(f"{n} works\n")

    # Drop people whose institution_id points at an institution we did not keep
    # (defensive; pick_institution only yields ones we store).
    valid = set(institutions)
    for p in people.values():
        if p["institution_id"] not in valid:
            p["institution_id"] = None

    pay_rows = [{"person_id": pid, "area_id": a, "year": y,
                 "papers": v["papers"], "adj": round(v["adj"], 5), "senior": v["senior"]}
                for (pid, a, y), v in pay.items()]

    sys.stderr.write(f"\nUpserting: {len(institutions)} institutions, {len(people)} people, "
                     f"{len(venues)} venues, {len(pay_rows)} person-area-year, {len(area_rows)} areas\n")
    rest("areas", area_rows, on_conflict="id")
    rest("institutions", list(institutions.values()), on_conflict="id")
    rest("people", list(people.values()), on_conflict="id")
    rest("venues", list(venues.values()), on_conflict="id")
    rest("person_area_year", pay_rows, on_conflict="person_id,area_id,year")

    total = len(institutions) + len(people) + len(venues) + len(pay_rows) + len(area_rows)
    data_run("openalex", rows=total,
             notes=f"ok inst={len(institutions)} people={len(people)} venues={len(venues)} pay={len(pay_rows)}",
             started=started)
    sys.stderr.write(f"Done. data_run #{started}, {total} rows total.\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-area", type=int, default=600)
    ap.add_argument("--from-year", type=int, default=datetime.date.today().year - 10)
    ap.add_argument("--max-authors", type=int, default=30)
    args = ap.parse_args()
    run(args.per_area, args.from_year, args.max_authors)
