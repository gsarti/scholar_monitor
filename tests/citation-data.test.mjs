import test from "node:test";
import assert from "node:assert/strict";
import { buildAnnualSeries, selectedAnnualData, citationPercentage, yearToDateProjection } from "../site/assets/citation-data.js";

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
