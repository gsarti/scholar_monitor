// Inline SVG charts, with one shared model for compact and detailed views.
import { projectAnnualSeries } from "./citation-data.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export function renderCitationsChart(container, citationsPerYear, { series = [], detailed = false, unavailable = false, onInspect = () => {} } = {}) {
  container.replaceChildren();
  if (unavailable) {
    const message = document.createElement("span");
    message.className = "chart-unavailable";
    message.textContent = "Annual totals for this selection are unavailable until per-paper data is refreshed.";
    container.appendChild(message);
    return;
  }
  const years = Object.keys(citationsPerYear || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!years.length) {
    container.textContent = "No annual citation data yet.";
    return;
  }
  const values = years.map(year => citationsPerYear[year] || 0);
  const projection = projectAnnualSeries(citationsPerYear, series);
  const currentYear = projection.year;
  const currentValue = projection.actual;
  const projected = currentValue + projection.extra;
  const maxVal = Math.max(1, ...values, projected);
  const width = detailed ? Math.max(320, container.clientWidth, years.length * 38 + 64) : Math.max(320, years.length * 22);
  const height = detailed ? (width < 600 ? 280 : 360) : 160;
  const pad = { top: 24, right: 12, bottom: 28, left: detailed ? 48 : 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const baselineY = height - pad.bottom;
  const slotW = innerW / years.length;
  const barW = slotW * (detailed ? 0.7 : 0.86);
  const y = value => baselineY - value / maxVal * innerH;

  function element(tag, attributes, text) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    if (text != null) el.textContent = text;
    return el;
  }
  const svg = element("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart-svg", role: detailed ? "group" : "img", "aria-label": detailed ? "Annual citations stacked by paper, with year-end projections" : "Citations per year for selected papers" });
  if (detailed) svg.style.minWidth = `${years.length * 38 + 64}px`;
  if (detailed) {
    for (let i = 0; i <= 4; i++) {
      const value = maxVal * i / 4;
      svg.appendChild(element("line", { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), class: "chart-grid" }));
      svg.appendChild(element("text", { x: pad.left - 8, y: y(value) + 4, "text-anchor": "end", class: "chart-axis-label" }, Math.round(value)));
    }
  }

  function rectangle(x, bottom, value, title, paper, projectedSegment = false) {
    if (value <= 0) return;
    const rect = element("rect", {
      x, y: y(bottom + value), width: barW, height: value / maxVal * innerH,
      class: `${projectedSegment ? "chart-bar-proj" : "chart-bar"}${paper ? " chart-segment" : ""}`,
    });
    if (paper) {
      rect.style.setProperty("--paper-colour", paper.colour);
      rect.dataset.paperId = paper.id;
      rect.setAttribute("tabindex", "0");
      rect.setAttribute("role", "button");
      rect.setAttribute("aria-label", title);
      rect.addEventListener("pointerenter", () => onInspect(title));
      rect.addEventListener("focus", () => onInspect(title));
      rect.addEventListener("click", () => onInspect(title));
      rect.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onInspect(title); }
      });
    }
    rect.appendChild(element("title", {}, title));
    svg.appendChild(rect);
  }

  years.forEach((year, i) => {
    const value = values[i];
    const x = pad.left + i * slotW + (slotW - barW) / 2;
    const extra = year === currentYear ? projected - value : 0;
    if (detailed) {
      let bottom = 0, allocated = 0;
      for (const paper of series) {
        const count = paper.values[year] || 0;
        rectangle(x, bottom, count, `${year} · ${paper.title}: ${count} citation${count === 1 ? "" : "s"}`, paper);
        bottom += count;
        const addition = year === currentYear ? projection.extraByPaper.get(paper.id) || 0 : 0;
        rectangle(x, value + allocated, addition, `${year} · ${paper.title}: ~${addition} additional citations projected (~${count + addition} total)`, paper, true);
        allocated += addition;
      }
    } else {
      rectangle(x, 0, value, `${year}: ${value}`);
      rectangle(x, value, extra, `${year} projected: ${projected} (based on ${value} citations in ${projection.elapsedDays} days)`, null, true);
    }
    if (extra > 0) {
      svg.appendChild(element("text", { x: x + barW / 2, y: y(value + extra) - 6, "text-anchor": "middle", class: "chart-tooltip chart-proj-label" }, `~${projected}`));
    }
    if (value > 0 && (extra === 0 || extra / maxVal * innerH > 16)) {
      svg.appendChild(element("text", { x: x + barW / 2, y: y(value) - 4, "text-anchor": "middle", class: "chart-tooltip" }, value));
    }
    if (detailed || years.length <= 12 || i % 2 === 0 || i === years.length - 1) {
      svg.appendChild(element("text", { x: x + barW / 2, y: height - 8, "text-anchor": "middle", class: "chart-axis-label" }, detailed ? year : String(year).slice(-2)));
    }
  });
  if (!values.some(value => value > 0)) {
    svg.appendChild(element("text", { x: width / 2, y: height / 2, "text-anchor": "middle", class: "chart-tooltip" }, "No citations for the selected papers"));
  }
  container.appendChild(svg);
}

export function renderSparkline(container, history, { width = 80, height = 20 } = {}) {
  container.innerHTML = "";
  const pts = (history || []).filter((p) => Number.isFinite(p.count) && Number.isFinite(Date.parse(p.date)));
  if (pts.length < 2) return;

  const values = pts.map((p) => p.count);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = Math.max(1, maxV - minV);

  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const from = Date.parse(pts[0].date);
  const to = Date.parse(pts[pts.length - 1].date);
  const x = (i) => pad + (to === from ? innerW / 2 : (Date.parse(pts[i].date) - from) / (to - from) * innerW);
  const y = (v) => pad + innerH - ((v - minV) / range) * innerH;

  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(" ");
  const area = `${path} L${x(pts.length - 1).toFixed(1)},${pad + innerH} L${x(0).toFixed(1)},${pad + innerH} Z`;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "chart-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Citations: ${pts[0].count} to ${pts[pts.length - 1].count}; scaled to this paper's history`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);

  const areaEl = document.createElementNS(SVG_NS, "path");
  areaEl.setAttribute("class", "sparkline-area");
  areaEl.setAttribute("d", area);
  svg.appendChild(areaEl);

  const lineEl = document.createElementNS(SVG_NS, "path");
  lineEl.setAttribute("class", "sparkline-line");
  lineEl.setAttribute("d", path);
  svg.appendChild(lineEl);

  const last = pts[pts.length - 1];
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("class", "sparkline-dot");
  dot.setAttribute("cx", x(pts.length - 1));
  dot.setAttribute("cy", y(last.count));
  dot.setAttribute("r", 1.5);
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = `${pts[0].date}: ${pts[0].count} → ${last.date}: ${last.count}`;
  svg.appendChild(title);
  svg.appendChild(dot);

  container.appendChild(svg);
}
