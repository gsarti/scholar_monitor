// Pure calculations shared by the compact and expanded charts.
export function latestCount(paper) {
  const history = paper.citation_count_history || [];
  return history.length ? history[history.length - 1].count : 0;
}

function citationIndices(counts) {
  const ordered = [...counts].sort((a, b) => b - a);
  return {
    h_index: ordered.filter((count, index) => count >= index + 1).length,
    i10_index: ordered.filter(count => count >= 10).length,
  };
}

export function selectedProfileStats(papers, profile, excluded = new Set()) {
  const latest = profile?.totals_history?.at(-1) || {};
  const selected = papers.filter(paper => !excluded.has(paper.id));
  if (!selected.length && papers.length) return { citations: 0, h_index: 0, i10_index: 0 };
  if (!papers.length) return { citations: latest.citations ?? null, h_index: latest.h_index ?? null, i10_index: latest.i10_index ?? null };
  const counts = selected.map(latestCount);
  const result = { citations: counts.reduce((sum, count) => sum + count, 0), ...citationIndices(counts) };
  // Preserve profile-only lifetime citations while removing each excluded paper.
  if (Number.isFinite(latest.citations)) {
    const removed = papers.filter(paper => excluded.has(paper.id)).reduce((sum, paper) => sum + latestCount(paper), 0);
    result.citations = Math.max(0, latest.citations - removed);
  }
  if (selected.length === papers.length) {
    result.h_index = latest.h_index ?? result.h_index;
    result.i10_index = latest.i10_index ?? result.i10_index;
  }
  return result;
}

export function citationPercentage(count, total) {
  if (total <= 0) return "—";
  const percentage = count / total * 100;
  if (percentage > 0 && percentage < 0.01) return "<0.01%";
  return `${Number(percentage.toFixed(2))}%`;
}

export function yearToDateProjection(actual, now = new Date()) {
  const year = now.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const next = Date.UTC(year + 1, 0, 1);
  const elapsedDays = Math.max(1, Math.floor((now.getTime() - start) / 86400000) + 1);
  const totalDays = Math.round((next - start) / 86400000);
  return { year, projected: Math.round(actual / elapsedDays * totalDays), elapsedDays, totalDays };
}

export function projectAnnualSeries(totals, series, now = new Date()) {
  const year = now.getUTCFullYear();
  const actual = totals[year] || 0;
  const projection = yearToDateProjection(actual, now);
  const extra = Math.max(0, projection.projected - actual);
  const extraByPaper = new Map();
  let cumulative = 0, allocated = 0;
  for (const paper of series) {
    cumulative += paper.values[year] || 0;
    // Share rounding across papers so their additions match the annual bar.
    const next = actual ? Math.round(extra * cumulative / actual) : 0;
    extraByPaper.set(paper.id, next - allocated);
    allocated = next;
  }
  return { ...projection, actual, extra, extraByPaper };
}

export function projectProfileStats(papers, profile, now = new Date(), excluded = new Set()) {
  const year = now.getUTCFullYear();
  const result = { year, citations: null, h_index: null, i10_index: null };
  const selected = papers.filter(paper => !excluded.has(paper.id));
  if (papers.length && !selected.length) return { year, citations: 0, h_index: 0, i10_index: 0 };
  if (!Object.hasOwn(profile?.citations_per_year || {}, year)) return result;
  const current = selectedProfileStats(papers, profile, excluded);
  const model = selectedAnnualData(buildAnnualSeries(papers), excluded, profile.citations_per_year);
  if (model.unavailable) return result;
  const projection = projectAnnualSeries(model.totals, model.series, now);
  if (Number.isFinite(current.citations)) result.citations = current.citations + projection.extra;
  // An unattributed current-year count cannot be assigned to a paper for the
  // h/i10 thresholds. The profile total can still be projected independently.
  if (model.partial || model.stale || model.unavailable || model.series.some(p => p.id === "unattributed" && p.values[year] > 0)) return result;
  const indices = citationIndices(selected.map(paper => latestCount(paper) + (projection.extraByPaper.get(paper.id) || 0)));
  result.h_index = Math.max(current.h_index || 0, indices.h_index);
  result.i10_index = Math.max(current.i10_index || 0, indices.i10_index);
  return result;
}

export function buildAnnualSeries(papers) {
  const colourOrder = [...papers].sort((a, b) => a.id.localeCompare(b.id));
  const colours = new Map(colourOrder.map((paper, i) => [paper.id, `hsl(${(210 + i * 137.508) % 360} 58% 48%)`]));
  return papers.map(paper => {
    const annual = paper.citations_per_year;
    const hasAnnual = annual && typeof annual === "object" && !Array.isArray(annual);
    const values = {};
    // Cited-by search results are incomplete inventories, not annual totals.
    for (const [year, value] of Object.entries(hasAnnual ? annual : {})) {
      if (/^\d{4}$/.test(year) && Number.isFinite(value) && value >= 0) values[year] = value;
    }
    return {
      id: paper.id,
      title: paper.title || "(untitled)",
      colour: colours.get(paper.id),
      values,
      partial: latestCount(paper) > 0 && !hasAnnual,
      stale: hasAnnual && paper.citations_per_year_count != null && paper.citations_per_year_count !== latestCount(paper),
    };
  });
}

export function selectedAnnualData(allSeries, excluded, profileYears = {}) {
  // Retain the same year domain even when every paper is unchecked.
  const totals = Object.fromEntries(Object.keys(profileYears).filter(y => /^\d{4}$/.test(y)).map(y => [y, 0]));
  for (const paper of allSeries) {
    for (const year of Object.keys(paper.values)) totals[year] = 0;
  }
  const selected = allSeries.filter(paper => !excluded.has(paper.id));
  const partial = selected.filter(p => p.partial).length;
  const stale = selected.filter(p => p.stale).length;
  const incomplete = allSeries.some(p => p.partial || p.stale);
  const hasProfile = Object.keys(profileYears).length > 0;
  const unavailable = selected.length > 0 && incomplete && (!hasProfile || allSeries.some(p => excluded.has(p.id) && (p.partial || p.stale)));
  const series = selected.filter(p => !p.partial && !p.stale);
  for (const paper of series) {
    for (const [year, value] of Object.entries(paper.values)) totals[year] += value;
  }
  if (hasProfile && selected.length && !unavailable) {
    // Preserve authoritative profile totals, including small discrepancies
    // between Scholar's profile graph and its individual paper graphs.
    // Only subtract an excluded paper when its complete annual totals are known.
    for (const year of Object.keys(totals)) {
      totals[year] = Math.max(0, (profileYears[year] || 0) - allSeries
        .filter(p => excluded.has(p.id))
        .reduce((sum, p) => sum + (p.values[year] || 0), 0));
    }
    // If independent snapshots disagree, don't invent attribution for that year.
    const conflicting = Object.keys(totals).filter(year => series.reduce((sum, p) => sum + (p.values[year] || 0), 0) > totals[year]);
    for (let i = 0; i < series.length; i++) {
      series[i] = { ...series[i], values: { ...series[i].values } };
      for (const year of conflicting) series[i].values[year] = 0;
    }
    const remainder = Object.fromEntries(Object.entries(totals).map(([year, total]) => [year,
      total - series.reduce((sum, p) => sum + (p.values[year] || 0), 0),
    ]));
    if (Object.values(remainder).some(value => value > 0)) {
      series.push({ id: "unattributed", title: incomplete ? "Paper breakdown pending" : "Unattributed profile citations", colour: "var(--muted)", values: remainder });
    }
  }
  return { series, totals, partial, stale, selectedCount: selected.length, unavailable };
}
