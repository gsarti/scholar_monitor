import { renderCitationsChart, renderSparkline } from "./chart.js";

import { latestCount, citationPercentage, buildAnnualSeries, selectedAnnualData, selectedProfileStats, projectProfileStats } from "./citation-data.js";
import { citationVenue } from "./venue-data.js";

const BASE = window.__SCHOLAR_MONITOR_BASE__ || "";
const CONFIG = window.__SCHOLAR_MONITOR_CONFIG__ || {};

const PAPERS_COLLAPSED_LIMIT = 10;

const state = {
  profile: null,
  papers: [],
  citations: [],           // all citing-paper records
  citationsByPaper: new Map(),
  citationsByPaperWindowed: new Map(),
  sort: { key: "citations", dir: "desc" },
  from: null,
  to: null,
  expanded: new Set(),
  excludeSelfCites: false,
  profileSurname: "",
  papersExpanded: false,
  excludedPapers: new Set(),
  annualSeries: [],
  venueMetadata: {},
};

async function fetchJSON(path, fallback) {
  try {
    const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

async function fetchJSONL(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
    if (!res.ok) return [];
    const text = await res.text();
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function parseISODate(s) {
  if (!s) return null;
  const parts = s.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  return { from: formatDate(from), to: formatDate(to) };
}

function readRangeFromURL() {
  const params = new URLSearchParams(window.location.search);
  return { from: params.get("from"), to: params.get("to") };
}

function writeRangeToURL(from, to, replace = true) {
  const url = new URL(window.location.href);
  if (from) url.searchParams.set("from", from); else url.searchParams.delete("from");
  if (to) url.searchParams.set("to", to); else url.searchParams.delete("to");
  if (state.excludeSelfCites) url.searchParams.set("exclude_self", "1");
  else url.searchParams.delete("exclude_self");
  const method = replace ? "replaceState" : "pushState";
  history[method]({}, "", url);
}

// ---------- Self-citation detection ----------

function extractSurname(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts[parts.length - 1] || "";
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeSurnameRegex(surname) {
  if (!surname) return null;
  return new RegExp(`\\b${escapeRegex(surname)}\\b`, "i");
}

function isSelfCitation(citingAuthors, surnameRe) {
  if (!surnameRe) return false;
  return surnameRe.test(citingAuthors || "");
}

// ---------- Theme ----------

const THEME_CYCLE = { auto: "light", light: "dark", dark: "auto" };
const THEME_META = {
  auto:  { icon: "◐", label: "Auto" },
  light: { icon: "☀", label: "Light" },
  dark:  { icon: "☾", label: "Dark" },
};

function currentTheme() {
  const stored = document.documentElement.dataset.theme;
  return stored === "light" || stored === "dark" ? stored : "auto";
}

function applyTheme(theme) {
  if (theme === "auto") {
    delete document.documentElement.dataset.theme;
    try { localStorage.removeItem("sm-theme"); } catch (_) {}
  } else {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("sm-theme", theme); } catch (_) {}
  }
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const meta = THEME_META[theme];
  btn.querySelector(".theme-toggle-icon").textContent = meta.icon;
  btn.querySelector(".theme-toggle-label").textContent = meta.label;
}

// ---------- Rendering ----------

function renderProfile() {
  const p = state.profile;
  if (!p) return;
  state.profileSurname = extractSurname(p.name);
  document.getElementById("profile-name").textContent = p.name || CONFIG.display_name || "Scholar Monitor";
  document.title = p.name ? `${p.name} — Scholar Monitor` : "Scholar Monitor";
  document.getElementById("profile-affiliation").textContent = p.affiliation || "";
  const emailEl = document.getElementById("profile-email");
  emailEl.textContent = p.email || "";
  const homepageEl = document.getElementById("profile-homepage");
  if (p.homepage) {
    homepageEl.textContent = "Homepage";
    homepageEl.href = p.homepage;
    homepageEl.style.display = "";
  } else {
    homepageEl.style.display = "none";
  }
  const labelsEl = document.getElementById("profile-labels");
  labelsEl.innerHTML = "";
  (p.labels || []).forEach((label) => {
    const li = document.createElement("li");
    li.textContent = label;
    labelsEl.appendChild(li);
  });
  const photoEl = document.getElementById("profile-photo");
  if (p.thumbnail) {
    photoEl.style.backgroundImage = `url("${p.thumbnail}")`;
  }
  if (CONFIG.repo_url) {
    const repoLink = document.getElementById("repo-link");
    const footerRepo = document.getElementById("footer-repo");
    if (repoLink) repoLink.href = CONFIG.repo_url;
    if (footerRepo) footerRepo.href = CONFIG.repo_url;
  }
}

function renderStats() {
  const history = (state.profile && state.profile.totals_history) || [];
  const latest = history[history.length - 1] || {};
  const current = selectedProfileStats(state.papers, state.profile, state.excludedPapers);
  const byId = (id, val) => { document.getElementById(id).textContent = val ?? "—"; };
  byId("stat-citations-all", current.citations);
  byId("stat-citations-recent", latest.citations_recent);
  byId("stat-h-all", current.h_index);
  byId("stat-h-recent", latest.h_index_recent);
  byId("stat-i10-all", current.i10_index);
  byId("stat-i10-recent", latest.i10_index_recent);
  const projection = projectProfileStats(state.papers, state.profile, new Date(), state.excludedPapers);
  for (const [id, key, label] of [
    ["stat-citations-all", "citations", "citations"],
    ["stat-h-all", "h_index", "h-index"],
    ["stat-i10-all", "i10_index", "i10-index"],
  ]) {
    const estimate = document.createElement("span");
    estimate.className = "stat-projection";
    const value = projection[key];
    estimate.textContent = value == null ? " → —" : ` → ~${value}`;
    estimate.title = value == null ? "Projection awaiting complete current-year citation data" : `Projected ${label} for selected papers by the end of ${projection.year}, using each paper's current annual citation rate`;
    estimate.setAttribute("aria-label", value == null ? estimate.title : `Projected year-end ${projection.year} ${label}: approximately ${value}`);
    document.getElementById(id).appendChild(estimate);
  }
  const scope = state.excludedPapers.size ? `${state.papers.length - state.excludedPapers.size} selected papers` : "all papers";
  byId("stats-projection-note", `→ Year-end ${projection.year} estimates · ${scope}`);
  byId("stats-updated", latest.date ? `Snapshot: ${latest.date}` : "No snapshot yet");
}

function renderChart() {
  const model = selectedAnnualData(state.annualSeries, state.excludedPapers, state.profile?.citations_per_year);
  renderCitationsChart(document.getElementById("citations-chart"), model.totals, { unavailable: model.unavailable });
  const selection = `${model.selectedCount} of ${state.papers.length} papers selected`;
  const coverage = model.partial || model.stale
    ? `Paper breakdown pending for ${model.partial + model.stale} selected papers. Full profile annual totals are preserved while all papers are selected.`
    : "";
  document.getElementById("chart-selection").textContent = [selection, coverage].filter(Boolean).join(" · ");
  if (!document.getElementById("citations-dialog").open) return;

  document.getElementById("citations-dialog-note").textContent = [selection + ".", coverage, "Faded segments show additional citations projected by year end at the current annual rate."].filter(Boolean).join(" ");
  const status = document.getElementById("chart-detail-status");
  status.textContent = model.unavailable ? "Select all papers to see the complete profile histogram." : model.selectedCount ? "Hover, focus or tap a segment to see its paper and citation count." : "No papers selected. Select papers in the table to include their citations.";
  renderCitationsChart(document.getElementById("citations-chart-detail"), model.totals, {
    series: model.series, detailed: true, unavailable: model.unavailable,
    onInspect: text => { status.textContent = text; },
  });
  const legend = document.getElementById("citations-chart-legend");
  legend.replaceChildren();
  if (model.unavailable) return;
  for (const paper of model.series) {
    if (!Object.values(paper.values).some(value => value > 0)) continue;
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "chart-swatch";
    swatch.style.backgroundColor = paper.colour;
    swatch.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.textContent = paper.title;
    item.append(swatch, title);
    legend.appendChild(item);
  }
}

function comparePapers(a, b) {
  const { key, dir } = state.sort;
  const mult = dir === "asc" ? 1 : -1;
  let av, bv;
  if (key === "title") { av = (a.title || "").toLowerCase(); bv = (b.title || "").toLowerCase(); }
  else if (key === "year") { av = a.year || 0; bv = b.year || 0; }
  else if (key === "new") {
    av = (state.citationsByPaperWindowed.get(a.id) || []).length;
    bv = (state.citationsByPaperWindowed.get(b.id) || []).length;
  } else if (key === "newPercent") {
    const aTotal = latestCount(a), bTotal = latestCount(b);
    // Undefined percentages sort last in either direction. Compare the raw
    // fractions so rounding in the displayed percentages cannot change order.
    if (aTotal <= 0 || bTotal <= 0) {
      if (aTotal <= 0 && bTotal <= 0) return 0;
      return aTotal <= 0 ? 1 : -1;
    }
    av = (state.citationsByPaperWindowed.get(a.id) || []).length / aTotal;
    bv = (state.citationsByPaperWindowed.get(b.id) || []).length / bTotal;
  } else { av = latestCount(a); bv = latestCount(b); }
  if (av < bv) return -1 * mult;
  if (av > bv) return 1 * mult;
  return 0;
}

function renderPublications() {
  const body = document.getElementById("publications-body");
  body.innerHTML = "";
  const sorted = [...state.papers].sort(comparePapers);
  const visible = state.papersExpanded ? sorted : sorted.slice(0, PAPERS_COLLAPSED_LIMIT);

  for (const paper of visible) {
    const tr = document.createElement("tr");
    tr.dataset.paperId = paper.id;
    tr.classList.toggle("paper-excluded", state.excludedPapers.has(paper.id));
    const selectTd = document.createElement("td");
    selectTd.className = "col-select";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !state.excludedPapers.has(paper.id);
    checkbox.setAttribute("aria-label", `Include ${paper.title || "untitled paper"} in histogram`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.excludedPapers.delete(paper.id);
      else state.excludedPapers.add(paper.id);
      tr.classList.toggle("paper-excluded", !checkbox.checked);
      if (tr.nextElementSibling?.classList.contains("citations-row")) {
        tr.nextElementSibling.classList.toggle("paper-excluded", !checkbox.checked);
      }
      updateSelectionControl();
      renderStats();
      renderChart();
    });
    selectTd.appendChild(checkbox);
    tr.appendChild(selectTd);

    const titleTd = document.createElement("td");
    titleTd.className = "col-title";
    const titleA = document.createElement("a");
    titleA.className = "paper-title";
    titleA.href = paper.link || "#";
    titleA.target = "_blank";
    titleA.rel = "noopener";
    titleA.textContent = paper.title || "(untitled)";
    titleTd.appendChild(titleA);
    if (paper.authors) {
      const a = document.createElement("span");
      a.className = "paper-authors";
      a.textContent = paper.authors;
      titleTd.appendChild(a);
    }
    if (paper.venue) {
      const v = document.createElement("span");
      v.className = "paper-venue";
      v.textContent = paper.venue;
      titleTd.appendChild(v);
    }
    tr.appendChild(titleTd);

    const citationsTd = document.createElement("td");
    citationsTd.className = "col-citations";
    const wrap = document.createElement("div");
    wrap.className = "cited-by-cell";
    const count = latestCount(paper);
    if (count > 0 && paper.cites_id) {
      const a = document.createElement("a");
      a.href = `https://scholar.google.com/scholar?cites=${paper.cites_id}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = count;
      wrap.appendChild(a);
    } else {
      const span = document.createElement("span");
      span.textContent = count || "";
      wrap.appendChild(span);
    }
    const sparkWrap = document.createElement("div");
    sparkWrap.className = "sparkline-wrap";
    renderSparkline(sparkWrap, paper.citation_count_history);
    wrap.appendChild(sparkWrap);
    citationsTd.appendChild(wrap);
    tr.appendChild(citationsTd);

    const newTd = document.createElement("td");
    newTd.className = "col-new";
    const windowed = state.citationsByPaperWindowed.get(paper.id) || [];
    const badge = document.createElement(windowed.length ? "button" : "span");
    badge.className = windowed.length ? "new-badge" : "new-badge empty";
    badge.textContent = `+${windowed.length}`;
    if (windowed.length) {
      badge.type = "button";
      badge.setAttribute("aria-expanded", String(state.expanded.has(paper.id)));
      badge.title = "Click to show new citing papers in this range";
      badge.addEventListener("click", () => toggleExpansion(paper.id));
    }
    newTd.appendChild(badge);
    tr.appendChild(newTd);

    const percentTd = document.createElement("td");
    percentTd.className = "col-new-percent";
    percentTd.textContent = citationPercentage(windowed.length, count);
    tr.appendChild(percentTd);

    const yearTd = document.createElement("td");
    yearTd.className = "col-year";
    yearTd.textContent = paper.year || "";
    tr.appendChild(yearTd);

    if (state.expanded.has(paper.id)) tr.classList.add("expanded");
    body.appendChild(tr);

    if (state.expanded.has(paper.id) && windowed.length) {
      const citingRow = renderCitingRow(windowed);
      citingRow.classList.toggle("paper-excluded", state.excludedPapers.has(paper.id));
      body.appendChild(citingRow);
    }
  }

  if (!sorted.length) {
    const empty = document.createElement("tr");
    empty.innerHTML = '<td colspan="6" style="padding:20px;color:var(--muted);text-align:center;">No publications yet. Run the scrape workflow to fetch data.</td>';
    body.appendChild(empty);
  }

  const toggle = document.getElementById("publications-toggle");
  if (toggle) {
    const hidden = sorted.length - visible.length;
    if (sorted.length > PAPERS_COLLAPSED_LIMIT) {
      toggle.hidden = false;
      toggle.textContent = state.papersExpanded
        ? "Show fewer papers"
        : `Show ${hidden} more paper${hidden === 1 ? "" : "s"}`;
    } else {
      toggle.hidden = true;
    }
  }

  updateSortHeaders();
  updateSelectionControl();
}

function updateSelectionControl() {
  const checkbox = document.getElementById("select-all-papers");
  checkbox.checked = state.papers.length > 0 && state.excludedPapers.size === 0;
  checkbox.indeterminate = state.excludedPapers.size > 0 && state.excludedPapers.size < state.papers.length;
  checkbox.disabled = state.papers.length === 0;
}

function renderCitingRow(citing) {
  const tpl = document.getElementById("citations-list-template");
  const row = tpl.content.firstElementChild.cloneNode(true);
  const ol = row.querySelector(".citing-papers");
  citing
    .slice()
    .sort((a, b) => (b.first_seen_date || "").localeCompare(a.first_seen_date || ""))
    .forEach((c) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = c.citing_link || "#";
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = c.citing_title || "(untitled)";
      li.appendChild(a);
      if (c.citing_authors) {
        const sp = document.createElement("span");
        sp.className = "citing-authors";
        sp.textContent = ` — ${c.citing_authors}`;
        li.appendChild(sp);
      }
      if (c.citing_venue || c.citing_year) {
        const sp = document.createElement("span");
        sp.className = "citing-venue";
        sp.textContent = ` (${[c.citing_venue, c.citing_year].filter(Boolean).join(", ")})`;
        li.appendChild(sp);
      }
      const dateSp = document.createElement("span");
      dateSp.className = "citing-authors";
      dateSp.textContent = ` · first seen ${c.first_seen_date}`;
      li.appendChild(dateSp);
      ol.appendChild(li);
    });
  return row;
}

function updateSortHeaders() {
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === state.sort.key) {
      th.classList.add(state.sort.dir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function toggleExpansion(paperId) {
  if (state.expanded.has(paperId)) state.expanded.delete(paperId);
  else state.expanded.add(paperId);
  renderPublications();
}

// ---------- Range filter ----------

function computeWindowedCitations() {
  state.citationsByPaperWindowed = new Map();
  const from = state.from, to = state.to;
  if (!from || !to || from > to) return;
  const surnameRe = state.excludeSelfCites ? makeSurnameRegex(state.profileSurname) : null;
  for (const row of state.citations) {
    if (row.bootstrap) continue;
    if (surnameRe && isSelfCitation(row.citing_authors, surnameRe)) continue;
    const d = row.first_seen_date;
    if (!d || d < from || d > to) continue;
    if (!state.citationsByPaperWindowed.has(row.paper_id)) {
      state.citationsByPaperWindowed.set(row.paper_id, []);
    }
    state.citationsByPaperWindowed.get(row.paper_id).push(row);
  }
}

// ---------- Aggregates: top citing authors / venues ----------

function aggregateTopAuthors(limit = 10) {
  const surnameRe = makeSurnameRegex(state.profileSurname);
  const counts = new Map();
  for (const row of state.citations) {
    if (state.excludeSelfCites && isSelfCitation(row.citing_authors, surnameRe)) continue;
    const raw = row.citing_authors || "";
    for (const name of raw.split(",")) {
      const n = name.trim();
      if (!n) continue;
      if (surnameRe && surnameRe.test(n)) continue; // never count the profile owner
      counts.set(n, (counts.get(n) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function aggregateTopVenues(limit = 10) {
  const surnameRe = state.excludeSelfCites ? makeSurnameRegex(state.profileSurname) : null;
  const counts = new Map();
  let incomplete = 0;
  for (const row of state.citations) {
    if (surnameRe && isSelfCitation(row.citing_authors, surnameRe)) continue;
    const v = citationVenue(row, state.venueMetadata);
    if (!v) { incomplete++; continue; }
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return { venues: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit), incomplete };
}

function renderAggregates() {
  const authorsList = document.getElementById("top-authors-list");
  const venuesList = document.getElementById("top-venues-list");
  authorsList.innerHTML = "";
  venuesList.innerHTML = "";

  const authors = aggregateTopAuthors();
  const { venues, incomplete } = aggregateTopVenues();
  const emptyMsg = (msg) => `<li style="color:var(--muted);border:none;font-style:italic;">${msg}</li>`;

  if (!authors.length) authorsList.innerHTML = emptyMsg("No citations yet.");
  else authors.forEach(([name, count]) => authorsList.appendChild(aggregateLi(name, count)));

  if (!venues.length) venuesList.innerHTML = emptyMsg(incomplete ? "No complete venue names available yet." : "No citations yet.");
  else venues.forEach(([name, count]) => venuesList.appendChild(aggregateLi(name, count)));

  const hint = state.excludeSelfCites ? "All-time, self-citations excluded" : "All-time, across all tracked papers";
  document.getElementById("top-authors-hint").textContent = hint;
  document.getElementById("top-venues-hint").textContent = incomplete
    ? `${hint} · ${incomplete} citations with unavailable venue names omitted`
    : hint;
}

function aggregateLi(name, count) {
  const li = document.createElement("li");
  const nameEl = document.createElement("span");
  nameEl.className = "name";
  nameEl.textContent = name;
  nameEl.title = name;
  const countEl = document.createElement("span");
  countEl.className = "count";
  countEl.textContent = `${count}`;
  li.appendChild(nameEl);
  li.appendChild(countEl);
  return li;
}

function updateDateHint() {
  const hint = document.getElementById("date-hint");
  if (!state.from || !state.to) { hint.textContent = ""; return; }
  const total = Array.from(state.citationsByPaperWindowed.values()).reduce((a, rows) => a + rows.length, 0);
  const base = total
    ? `${total} new citation${total === 1 ? "" : "s"} across ${state.citationsByPaperWindowed.size} paper${state.citationsByPaperWindowed.size === 1 ? "" : "s"}`
    : "No new citations in this range";

  // Count self-cites that fall in range (regardless of whether the toggle is on)
  // so the user sees the toggle's effect even when the count is small.
  let selfInRange = 0;
  if (state.profileSurname) {
    const re = makeSurnameRegex(state.profileSurname);
    for (const row of state.citations) {
      if (row.bootstrap) continue;
      const d = row.first_seen_date;
      if (!d || d < state.from || d > state.to) continue;
      if (isSelfCitation(row.citing_authors, re)) selfInRange++;
    }
  }
  let suffix = "";
  if (selfInRange > 0) {
    suffix = state.excludeSelfCites
      ? ` · ${selfInRange} self-citation${selfInRange === 1 ? "" : "s"} excluded`
      : ` · ${selfInRange} self-citation${selfInRange === 1 ? "" : "s"} included`;
  }
  hint.textContent = base + suffix;
}

function applyRange(from, to, { pushURL = true } = {}) {
  state.from = from;
  state.to = to;
  document.getElementById("date-from").value = from || "";
  document.getElementById("date-to").value = to || "";
  if (pushURL) writeRangeToURL(from, to);
  computeWindowedCitations();
  updateDateHint();
  renderPublications();
  renderAggregates();
}

// ---------- Init ----------

function wireControls() {
  document.getElementById("select-all-papers").addEventListener("change", (event) => {
    state.excludedPapers = event.target.checked ? new Set() : new Set(state.papers.map(p => p.id));
    renderPublications();
    renderStats();
    renderChart();
  });

  const dialog = document.getElementById("citations-dialog");
  document.getElementById("chart-expand").addEventListener("click", () => {
    dialog.showModal();
    renderChart();
  });
  document.getElementById("citations-dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });

  document.getElementById("date-from").addEventListener("change", (e) => {
    applyRange(e.target.value, state.to);
  });
  document.getElementById("date-to").addEventListener("change", (e) => {
    applyRange(state.from, e.target.value);
  });
  document.getElementById("date-reset").addEventListener("click", () => {
    const { from, to } = defaultRange();
    applyRange(from, to);
  });

  const selfCiteBox = document.getElementById("exclude-self-cites");
  selfCiteBox.checked = state.excludeSelfCites;
  selfCiteBox.addEventListener("change", (e) => {
    state.excludeSelfCites = e.target.checked;
    writeRangeToURL(state.from, state.to);
    computeWindowedCitations();
    updateDateHint();
    renderPublications();
    renderAggregates();
  });

  document.getElementById("theme-toggle").addEventListener("click", () => {
    applyTheme(THEME_CYCLE[currentTheme()]);
  });

  document.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort.key = key;
        state.sort.dir = key === "title" ? "asc" : "desc";
      }
      renderPublications();
    });
  });

  const toggle = document.getElementById("publications-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      state.papersExpanded = !state.papersExpanded;
      renderPublications();
    });
  }
}

function indexCitations() {
  state.citationsByPaper = new Map();
  for (const row of state.citations) {
    if (!state.citationsByPaper.has(row.paper_id)) state.citationsByPaper.set(row.paper_id, []);
    state.citationsByPaper.get(row.paper_id).push(row);
  }
}

function renderFooter() {
  const history = (state.profile && state.profile.totals_history) || [];
  const last = history[history.length - 1];
  const el = document.getElementById("last-updated");
  el.textContent = last ? `Last updated ${last.date}` : "No data yet";
}

async function main() {
  const [profile, papers, citations, venueMetadata] = await Promise.all([
    fetchJSON("/data/profile.json", null),
    fetchJSON("/data/papers.json", []),
    fetchJSONL("/data/citations.jsonl"),
    fetchJSON("/data/venues.json", {}),
  ]);
  state.profile = profile;
  state.papers = papers || [];
  state.citations = citations || [];
  state.venueMetadata = venueMetadata || {};
  indexCitations();
  state.annualSeries = buildAnnualSeries(state.papers);

  const urlParams = new URLSearchParams(window.location.search);
  state.excludeSelfCites = urlParams.get("exclude_self") === "1";

  applyTheme(currentTheme());
  renderProfile();
  renderStats();
  renderChart();
  renderFooter();
  wireControls();

  const urlRange = readRangeFromURL();
  const initial = urlRange.from && urlRange.to ? urlRange : defaultRange();
  applyRange(initial.from, initial.to, { pushURL: !(urlRange.from && urlRange.to) });
}

main().catch((err) => {
  console.error(err);
  document.getElementById("publications-body").innerHTML =
    '<tr><td colspan="6" style="padding:20px;color:#c62828;">Failed to load data. Check the browser console.</td></tr>';
});
