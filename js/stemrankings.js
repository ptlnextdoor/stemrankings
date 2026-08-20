/*
  STEMRankings - faithful CSRankings clone generalized to all STEM areas.
  Renders CSRankings' exact table markup (rank-cell, triangle widget, flag,
  Count/Faculty columns, expandable faculty tables). Ranking math is identical:
  smoothed geometric mean of per-area adjusted counts.
*/
var csr; // global for inline onclick handlers, like CSRankings' `csr`
(function () {
  "use strict";

  const DATA = {
    areas: "data/areas.json",
    authorInfo: "data/generated-author-info.csv",
    authors: "data/authors.csv",
    institutions: "data/institutions.csv",
  };
  const RightTriangle = "\u25B6";
  const DownTriangle = "\u25BC";
  const homeImg = 'png/house-logo.png';

  const S = {
    divisions: [], areaOrder: [], areaTitle: {}, areaDiv: {}, divColor: {},
    weights: {}, authorInfo: [], instRegion: {}, instCC: {}, authorMeta: {},
    minYear: 2015, maxYear: 2025, expanded: {},
  };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => encodeURIComponent(s);
  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function loadCSV(url) {
    return new Promise((res, rej) => Papa.parse(url, {
      header: true, download: true, skipEmptyLines: true,
      complete: (r) => res(r.data), error: rej,
    }));
  }

  async function boot() {
    const cfg = await (await fetch(DATA.areas)).json();
    S.divisions = cfg.divisions;
    for (const d of S.divisions) {
      S.divColor[d.id] = d.color;
      for (const a of d.areas) {
        S.areaOrder.push(a.id);
        S.areaTitle[a.id] = a.title;
        S.areaDiv[a.id] = d.id;
        S.weights[a.id] = 1;
      }
    }
    const [info, insts, authors] = await Promise.all([
      loadCSV(DATA.authorInfo), loadCSV(DATA.institutions), loadCSV(DATA.authors),
    ]);
    S.authorInfo = info;
    for (const i of insts) { S.instRegion[i.institution] = i.region; S.instCC[i.institution] = (i.countryabbrv || "").toLowerCase(); }
    for (const a of authors) S.authorMeta[a.name] = { orcid: a.orcid };

    let lo = Infinity, hi = -Infinity;
    for (const r of info) { const y = +r.year; if (y < lo) lo = y; if (y > hi) hi = y; }
    S.minYear = isFinite(lo) ? lo : 2015;
    S.maxYear = isFinite(hi) ? hi : 2025;

    buildYearSelects();
    buildDivisionIndicators();
    buildAreaMenu();
    wire();
    render();
  }

  function buildYearSelects() {
    const f = $("#fromyear"), t = $("#toyear");
    for (let y = S.minYear; y <= S.maxYear; y++) { f.add(new Option(y, y)); t.add(new Option(y, y)); }
    f.value = S.minYear; t.value = S.maxYear;
  }

  function buildDivisionIndicators() {
    const host = $("#division-indicators");
    host.innerHTML = "";
    for (const d of S.divisions) {
      const span = document.createElement("span");
      span.className = "area-indicator";
      span.style.backgroundColor = d.color;
      span.style.color = "#fff";
      span.textContent = d.title;
      span.title = d.title + " areas: click to toggle";
      span.addEventListener("click", () => {
        const anyOn = d.areas.some((a) => S.weights[a.id]);
        for (const a of d.areas) S.weights[a.id] = anyOn ? 0 : 1;
        syncMenu(); render();
      });
      host.append(span);
    }
  }

  function buildAreaMenu() {
    const tb = $("#area-menu");
    tb.innerHTML = "";
    for (const d of S.divisions) {
      const head = document.createElement("tr");
      head.className = "division-head-row";
      head.innerHTML = `<th colspan="2" style="text-align:left;">
        <span class="area-toggle-btn" data-div="${d.id}" style="color:${d.color};cursor:pointer;">${escHtml(d.title)}</span></th>`;
      head.querySelector(".area-toggle-btn").addEventListener("click", () => {
        const anyOn = d.areas.some((a) => S.weights[a.id]);
        for (const a of d.areas) S.weights[a.id] = anyOn ? 0 : 1;
        syncMenu(); render();
      });
      tb.append(head);

      for (const a of d.areas) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td><label for="cb-${a.id}" style="cursor:pointer;">${escHtml(a.title)}</label></td>` +
          `<td width="40px" align="right"><input type="checkbox" class="parent" id="cb-${a.id}" data-area="${a.id}" checked></td>`;
        tr.querySelector("input").addEventListener("change", (e) => {
          S.weights[a.id] = e.target.checked ? 1 : 0; syncIndicators(); render();
        });
        tb.append(tr);
      }
    }
  }

  function syncMenu() {
    document.querySelectorAll('#area-menu input[data-area]').forEach((b) => {
      b.checked = !!S.weights[b.dataset.area];
    });
    syncIndicators();
  }
  function syncIndicators() {
    const all = S.areaOrder.every((id) => S.weights[id]);
    $("#all-areas").checked = all;
  }

  function setAll(v) { for (const id of S.areaOrder) S.weights[id] = v; syncMenu(); render(); }

  function wire() {
    $("#all-areas").addEventListener("change", (e) => setAll(e.target.checked ? 1 : 0));
    $("#regions").addEventListener("change", render);
    $("#fromyear").addEventListener("change", render);
    $("#toyear").addEventListener("change", render);
  }

  // ---- ranking (CSRankings buildDepartments + computeStats) ----
  function computeRanking() {
    const fromY = +$("#fromyear").value, toY = +$("#toyear").value, region = $("#regions").value;
    const selected = S.areaOrder.filter((id) => S.weights[id]);
    const numAreas = selected.length;
    const areaDeptAdj = {}, deptFaculty = {}, facRaw = {}, facAdj = {};
    if (numAreas === 0) return { numAreas, stats: {}, ranked: [], deptFaculty, facRaw, facAdj };

    const sel = new Set(selected);
    for (const r of S.authorInfo) {
      if (!sel.has(r.area)) continue;
      const y = +r.year; if (y < fromY || y > toY) continue;
      const dept = r.dept;
      if (region !== "world" && S.instRegion[dept] !== region) continue;
      const adj = parseFloat(r.adjustedcount) || 0;
      const raw = parseInt(r.count) || 0;
      const key = r.area + "\u0000" + dept;
      areaDeptAdj[key] = (areaDeptAdj[key] || 0) + adj;
      let fac = deptFaculty[dept]; if (!fac) { fac = new Set(); deptFaculty[dept] = fac; }
      fac.add(r.name);
      facRaw[dept] = facRaw[dept] || {}; facAdj[dept] = facAdj[dept] || {};
      facRaw[dept][r.name] = (facRaw[dept][r.name] || 0) + raw;
      facAdj[dept][r.name] = (facAdj[dept][r.name] || 0) + adj;
    }
    const stats = {};
    for (const dept in deptFaculty) {
      let prod = 1;
      for (const area of selected) prod *= ((areaDeptAdj[area + "\u0000" + dept] || 0) + 1.0);
      stats[dept] = Math.pow(prod, 1 / numAreas);
    }
    const ranked = Object.keys(stats).sort((a, b) =>
      stats[b] !== stats[a] ? stats[b] - stats[a] : (a < b ? -1 : 1));
    return { numAreas, stats, ranked, deptFaculty, facRaw, facAdj };
  }

  function facultyTable(dept, facSet, facRaw, facAdj) {
    const names = [...facSet].sort((a, b) => {
      const ra = facRaw[a] || 0, rb = facRaw[b] || 0;
      if (rb !== ra) return rb - ra;
      const aa = Math.round(10 * (facAdj[a] || 0)), ab = Math.round(10 * (facAdj[b] || 0));
      return ab !== aa ? ab - aa : (a < b ? -1 : 1);
    });
    let p = '<div class="table"><table class="table table-sm table-striped"><thead><th></th>'
      + '<td><small><em>Faculty</em></small></td>'
      + '<td align="right"><small><em>&nbsp;&nbsp;# Pubs</em></small></td>'
      + '<td align="right"><small><em>Adj. #</em></small></td></thead><tbody>';
    for (const name of names) {
      const meta = S.authorMeta[name] || {};
      const worksUrl = `https://openalex.org/works?search=${esc(name)}`;
      let links = `<a class="hovertip" target="_blank" rel="noopener" href="${worksUrl}" title="OpenAlex works" onclick="event.stopPropagation();"><img alt="works" src="${homeImg}"></a>`;
      if (meta.orcid && meta.orcid !== "0000-0000-0000-0000") {
        links += `&nbsp;<a target="_blank" rel="noopener" class="orcid-link" href="https://orcid.org/${meta.orcid}" title="ORCID" onclick="event.stopPropagation();">iD</a>`;
      }
      p += `<tr class="faculty-row" style="cursor:pointer;" onclick="window.open('${worksUrl}','_blank');" title="Click to view ${escHtml(name)}'s works">`
        + `<td>&nbsp;&nbsp;&nbsp;&nbsp;</td>`
        + `<td><small><a target="_blank" rel="noopener" href="${worksUrl}" onclick="event.stopPropagation();">${escHtml(name)}</a>&nbsp;${links}</small></td>`
        + `<td align="right"><small>${facRaw[name] || 0}</small></td>`
        + `<td align="right"><small>${(Math.round(10 * (facAdj[name] || 0)) / 10).toFixed(1)}</small></td></tr>`;
    }
    return p + "</tbody></table></div>";
  }

  function render() {
    const R = computeRanking();
    const host = $("#success");
    if (R.numAreas === 0) {
      host.innerHTML = `<div class="no-areas-selected"><div class="no-areas-message"><strong>No areas selected.</strong> Click an area to select it.</div></div>`;
      return;
    }
    // round stats like CSRankings
    for (const k in R.stats) R.stats[k] = Math.round(10 * R.stats[k]) / 10;
    const keys = R.ranked.filter((d) => R.stats[d] > 0);

    let s = '<div class="table-responsive" style="overflow:auto; height:700px;">'
      + '<table class="table table-fit table-sm table-striped" id="ranking" valign="top">'
      + '<thead><tr><th></th><th align="left"><font color="#777">Institution</font>'
      + '&nbsp;'.repeat(20)
      + '</th><th align="right"><abbr title="Geometric mean count across all selected areas."><font color="#777">Count</font></abbr></th>'
      + '<th align="right">&nbsp;<abbr title="Number of faculty active in these areas."><font color="#777">Faculty</font></abbr></th></tr></thead><tbody>';

    let rank = 0, oldv = 9999999.999, ties = 1;
    const minToRank = 100;
    for (let ind = 0; ind < keys.length; ind++) {
      const dept = keys[ind], v = R.stats[dept];
      if (ind >= minToRank && v !== oldv) break;
      if (v === 0) break;
      if (oldv !== v) { rank = rank + 1; }  // dense ranking
      const e = esc(dept);
      const cc = S.instCC[dept] || "";
      const flag = cc ? `<img class="flag" title="${cc.toUpperCase()}" src="https://flagcdn.com/16x12/${cc}.png" width="16" height="12">` : "";
      const open = S.expanded[dept];
      s += `\n<tr class="inst-row${ind % 2 ? " stripe" : ""}"><td class="rank-cell">${rank}</td>`
        + `<td><span class="hovertip" onclick="csr.toggleFaculty('${e}');" id="${e}-widget" title="Click to show/hide faculty">${open ? DownTriangle : RightTriangle}</span>`
        + `&nbsp;<span onclick="csr.toggleFaculty('${e}');" style="cursor:pointer;">${escHtml(dept)}</span>&nbsp;${flag}</td>`
        + `<td align="right">${v.toFixed(1)}</td>`
        + `<td align="right">${R.deptFaculty[dept].size}</td></tr>`;
      if (open) {
        s += `<tr class="faculty-container"><td colspan="4"><div id="${e}-faculty">`
          + facultyTable(dept, R.deptFaculty[dept], R.facRaw[dept], R.facAdj[dept])
          + `</div></td></tr>`;
      }
      oldv = v; ties++;
    }
    s += "</tbody></table></div>";
    host.innerHTML = s;
    S._lastRanking = R;
  }

  csr = {
    toggleFaculty(e) {
      const dept = decodeURIComponent(e);
      S.expanded[dept] = !S.expanded[dept];
      render();
    },
  };

  boot().catch((err) => { $("#success").innerHTML = "Failed to load: " + err; console.error(err); });
})();
