import test from "node:test";
import assert from "node:assert/strict";
import { buildAnnualSeries, selectedAnnualData, citationPercentage, yearToDateProjection, projectAnnualSeries, selectedProfileStats, projectProfileStats } from "../site/assets/citation-data.js";

const paper = (id, counts, annual) => ({
  id, title: id, citation_count_history: counts.map((count, i) => ({ date: `2026-04-${23 + i}`, count })),
  ...(annual ? { citations_per_year: annual, citations_per_year_count: counts.at(-1) } : {}),
});

test("new citation shares are percentages, with safe zero totals and small values", () => {
  assert.equal(citationPercentage(200, 800), "25%");
  assert.equal(citationPercentage(1, 3), "33.33%");
  assert.equal(citationPercentage(0, 10), "0%");
  assert.equal(citationPercentage(0, 0), "—");
  assert.equal(citationPercentage(1, 100000), "<0.01%");
});

test("annual source counts supersede incomplete citation inventories without double counting", () => {
  const series = buildAnnualSeries([paper("a", [800], { 2025: 600, 2026: 200 })], [
    { paper_id: "a", citing_year: 2026 }, { paper_id: "a", citing_year: 2026 },
  ]);
  assert.deepEqual(series[0].values, { 2025: 600, 2026: 200 });
  assert.equal(series[0].partial, false);
});

test("selection recomputes annual and projected totals and supports selecting none", () => {
  const series = buildAnnualSeries([paper("a", [800], { 2025: 600, 2026: 200 }), paper("b", [100], { 2025: 50, 2026: 50 })], []);
  const all = selectedAnnualData(series, new Set());
  const filtered = selectedAnnualData(series, new Set(["a"]));
  assert.deepEqual(all.totals, { 2025: 650, 2026: 250 });
  assert.deepEqual(filtered.totals, { 2025: 50, 2026: 50 });
  const date = new Date("2026-07-01T12:00:00Z");
  assert.equal(yearToDateProjection(all.totals[2026], date).projected, 501);
  assert.equal(yearToDateProjection(filtered.totals[2026], date).projected, 100);
  assert.deepEqual(selectedAnnualData(series, new Set(["a", "b"])).totals, { 2025: 0, 2026: 0 });
});

test("legacy citation inventories are never substituted for complete annual totals", () => {
  const series = buildAnnualSeries([paper("a", [10])], [
    { paper_id: "a", citing_year: 2025, bootstrap: true },
    { paper_id: "a", citing_year: null, first_seen_date: "2026-04-23" },
  ]);
  assert.deepEqual(series[0].values, {});
  assert.equal(selectedAnnualData(series, new Set()).partial, 1);
  assert.equal(selectedAnnualData(series, new Set()).unavailable, true);
  assert.equal(selectedAnnualData(series, new Set(["a"])).partial, 0);
});

test("profile annual totals survive a missing paper breakdown, including older years", () => {
  const series = buildAnnualSeries([paper("a", [800]), paper("b", [100])]);
  const profileYears = { 2020: 7, 2021: 10, 2022: 36, 2023: 101, 2024: 184, 2025: 627, 2026: 1044 };
  const all = selectedAnnualData(series, new Set(), profileYears);
  assert.deepEqual(all.totals, profileYears);
  assert.equal(all.selectedCount, 2);
  assert.equal(all.unavailable, false);
  assert.deepEqual(all.series[0].values, profileYears);
  assert.equal(all.series[0].id, "unattributed");
  assert.equal(selectedAnnualData(series, new Set(["a"]), profileYears).unavailable, true);
  const none = selectedAnnualData(series, new Set(["a", "b"]), profileYears);
  assert.equal(none.unavailable, false);
  assert.ok(Object.values(none.totals).every(value => value === 0));
});

test("a partial backfill can subtract fully known papers while retaining unattributed totals", () => {
  const series = buildAnnualSeries([paper("a", [800]), paper("b", [100], { 2025: 50, 2026: 50 })]);
  const filtered = selectedAnnualData(series, new Set(["b"]), { 2025: 600, 2026: 300 });
  assert.equal(filtered.unavailable, false);
  assert.deepEqual(filtered.totals, { 2025: 550, 2026: 250 });
  const all = selectedAnnualData(series, new Set(), { 2025: 600, 2026: 300 });
  assert.equal(all.series.find(p => p.id === "b").values[2025], 50);
  assert.deepEqual(all.series.find(p => p.id === "unattributed").values, { 2025: 550, 2026: 250 });
});

test("profile-only citations stay explicitly unattributed after the complete backfill", () => {
  const series = buildAnnualSeries([paper("a", [10], { 2023: 5, 2026: 5 }), paper("b", [20], { 2026: 20 })]);
  const all = selectedAnnualData(series, new Set(), { 2023: 6, 2026: 25 });
  assert.deepEqual(all.totals, { 2023: 6, 2026: 25 });
  const remainder = all.series.find(p => p.id === "unattributed");
  assert.equal(remainder.title, "Unattributed profile citations");
  assert.deepEqual(remainder.values, { 2023: 1, 2026: 0 });
  const filtered = selectedAnnualData(series, new Set(["a"]), { 2023: 6, 2026: 25 });
  assert.deepEqual(filtered.totals, { 2023: 1, 2026: 20 });
  assert.equal(filtered.unavailable, false);
});

test("failed refreshes are marked stale and paper colours survive sorting", () => {
  const a = paper("a", [11], { 2026: 10 });
  a.citations_per_year_count = 10;
  const b = paper("b", [0], {});
  const forward = buildAnnualSeries([a, b], []);
  const reverse = buildAnnualSeries([b, a], []);
  assert.equal(forward[0].colour, reverse[1].colour);
  assert.equal(selectedAnnualData(forward, new Set()).stale, 1);
});

test("year-end and leap-year projections do not create invalid overhangs", () => {
  assert.equal(yearToDateProjection(25, new Date("2024-12-31T23:59:00Z")).projected, 25);
  assert.equal(yearToDateProjection(0, new Date("2026-01-01T00:00:00Z")).projected, 0);
  assert.equal(yearToDateProjection(1, new Date("2024-01-01T00:00:00Z")).projected, 366);
});

test("profile projections add only future citations and recalculate h/i10 thresholds", () => {
  const papers = [paper("a", [10], { 2026: 2 }), paper("b", [9], { 2026: 2 }), paper("c", [3], { 2026: 1 }), paper("d", [3], { 2026: 1 })];
  const profile = { citations_per_year: { 2026: 6 }, totals_history: [{ citations: 30, h_index: 3, i10_index: 1 }] };
  // Preserve the five lifetime citations absent from per-paper totals.
  assert.deepEqual(projectProfileStats(papers, profile, new Date("2026-07-01T12:00:00Z")), { year: 2026, citations: 36, h_index: 4, i10_index: 2 });
  assert.deepEqual(projectProfileStats(papers, profile, new Date("2026-12-31T12:00:00Z")), { year: 2026, citations: 30, h_index: 3, i10_index: 1 });
});

test("base profile statistics follow selection even without annual citation data", () => {
  const papers = [paper("a", [100]), paper("b", [10]), paper("c", [3]), paper("d", [3])];
  const profile = { totals_history: [{ citations: 118, h_index: 3, i10_index: 2 }] };
  const excluded = new Set();
  const all = selectedProfileStats(papers, profile, excluded);
  assert.deepEqual(all, { citations: 118, h_index: 3, i10_index: 2 });
  excluded.add("a");
  assert.deepEqual(selectedProfileStats(papers, profile, excluded), { citations: 18, h_index: 3, i10_index: 1 });
  excluded.add("b");
  assert.deepEqual(selectedProfileStats(papers, profile, excluded), { citations: 8, h_index: 2, i10_index: 0 });
  excluded.add("c");
  excluded.add("d");
  assert.deepEqual(selectedProfileStats(papers, profile, excluded), { citations: 0, h_index: 0, i10_index: 0 });
  excluded.clear();
  assert.deepEqual(selectedProfileStats(papers, profile, excluded), all);
  assert.deepEqual(selectedProfileStats([], null), { citations: null, h_index: null, i10_index: null });
});

test("profile indices use the histogram's exact allocation of rounded additions", () => {
  const papers = [paper("a", [8], { 2026: 1 }), paper("b", [9], { 2026: 1 }), paper("c", [1], { 2026: 1 })];
  const profile = { citations_per_year: { 2026: 3 }, totals_history: [{ citations: 18, h_index: 2, i10_index: 0 }] };
  const date = new Date("2026-10-01T12:00:00Z");
  const model = selectedAnnualData(buildAnnualSeries(papers), new Set(), profile.citations_per_year);
  const projection = projectAnnualSeries(model.totals, model.series, date);
  assert.equal(projection.extra, 1);
  assert.deepEqual([...projection.extraByPaper.values()], [0, 1, 0]);
  assert.equal([...projection.extraByPaper.values()].reduce((a, b) => a + b, 0), projection.extra);
  assert.deepEqual(projectProfileStats(papers, profile, date), { year: 2026, citations: 19, h_index: 2, i10_index: 1 });
});

test("unchecking papers recalculates all estimates and selecting all restores them", () => {
  const papers = [paper("a", [10], { 2026: 2 }), paper("b", [9], { 2026: 2 }), paper("c", [3], { 2026: 1 }), paper("d", [3], { 2026: 1 })];
  const profile = { citations_per_year: { 2026: 6 }, totals_history: [{ citations: 25, h_index: 3, i10_index: 1 }] };
  const date = new Date("2026-07-01T12:00:00Z");
  const excluded = new Set();
  const all = projectProfileStats(papers, profile, date, excluded);
  assert.deepEqual(all, { year: 2026, citations: 31, h_index: 4, i10_index: 2 });
  excluded.add("a");
  assert.deepEqual(projectProfileStats(papers, profile, date, excluded), { year: 2026, citations: 19, h_index: 3, i10_index: 1 });
  excluded.add("b");
  assert.deepEqual(projectProfileStats(papers, profile, date, excluded), { year: 2026, citations: 8, h_index: 2, i10_index: 0 });
  excluded.add("c");
  excluded.add("d");
  assert.deepEqual(projectProfileStats(papers, profile, date, excluded), { year: 2026, citations: 0, h_index: 0, i10_index: 0 });
  excluded.clear();
  assert.deepEqual(projectProfileStats(papers, profile, date, excluded), all);
});

test("selection projections preserve residual citations and reject unknown exclusions", () => {
  const papers = [paper("a", [10], { 2026: 2 }), paper("b", [9], { 2026: 2 })];
  const profile = { citations_per_year: { 2026: 4 }, totals_history: [{ citations: 20, h_index: 2, i10_index: 1 }] };
  const date = new Date("2026-07-01T12:00:00Z");
  assert.deepEqual(projectProfileStats(papers, profile, date, new Set(["a"])), { year: 2026, citations: 12, h_index: 1, i10_index: 1 });
  assert.deepEqual(projectProfileStats(papers, profile, date, new Set(["a", "b"])), { year: 2026, citations: 0, h_index: 0, i10_index: 0 });
  delete papers[0].citations_per_year;
  assert.deepEqual(projectProfileStats(papers, profile, date, new Set(["a"])), { year: 2026, citations: null, h_index: null, i10_index: null });
});

test("missing, stale or unattributed annual data cannot produce projected indices", () => {
  const profile = { citations_per_year: { 2026: 5 }, totals_history: [{ citations: 10, h_index: 1, i10_index: 1 }] };
  const date = new Date("2026-07-01T12:00:00Z");
  const stale = paper("a", [10], { 2026: 5 });
  stale.citations_per_year_count = 9;
  for (const papers of [[paper("a", [10])], [stale], [paper("a", [10], { 2026: 4 })]]) {
    assert.deepEqual(projectProfileStats(papers, profile, date), { year: 2026, citations: 15, h_index: null, i10_index: null });
  }
  assert.deepEqual(projectProfileStats([], null, date), { year: 2026, citations: null, h_index: null, i10_index: null });
  assert.equal(projectProfileStats([paper("a", [10], { 2026: 5 })], profile, new Date("2027-01-01T12:00:00Z")).citations, null);
});
