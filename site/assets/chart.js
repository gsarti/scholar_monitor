// Minimal inline-SVG bar chart for citations-per-year.

const SVG_NS = "http://www.w3.org/2000/svg";

function yearToDateProjection(actual) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const next = Date.UTC(year + 1, 0, 1);
  const msPerDay = 86400000;
  const elapsedDays = Math.max(1, Math.floor((now.getTime() - start) / msPerDay) + 1);
  const totalDays = Math.round((next - start) / msPerDay);
  return { year, projected: Math.round((actual / elapsedDays) * totalDays), elapsedDays, totalDays };
}

export function renderCitationsChart(container, citationsPerYear) {
  container.innerHTML = "";
  const years = Object.keys(citationsPerYear || {})
    .map(Number)
    .filter((y) => !Number.isNaN(y))
    .sort((a, b) => a - b);
  if (!years.length) return;

  const values = years.map((y) => citationsPerYear[String(y)] || 0);

  // Projection for the current year, if present in the data.
  const currentYear = new Date().getUTCFullYear();
  const currentIdx = years.indexOf(currentYear);
  let projection = null;
  if (currentIdx !== -1 && values[currentIdx] > 0) {
    const p = yearToDateProjection(values[currentIdx]);
    if (p.projected > values[currentIdx]) projection = { idx: currentIdx, ...p };
  }

  const maxVal = Math.max(1, ...values, projection ? projection.projected : 0);

  const width = 320;
  const height = 150;
  const pad = { top: 16, right: 8, bottom: 22, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const barGap = 3;
  const barW = Math.max(4, (innerW - (years.length - 1) * barGap) / years.length);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "chart-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Citations per year");

  years.forEach((year, i) => {
    const val = values[i];
    const h = (val / maxVal) * innerH;
    const x = pad.left + i * (barW + barGap);
    const y = pad.top + (innerH - h);

    // Projection overhang for the current year: a lighter rect above the actual bar
    // extending up to the projected total.
    if (projection && i === projection.idx) {
      const projH = (projection.projected / maxVal) * innerH;
      const projY = pad.top + (innerH - projH);
      const projRect = document.createElementNS(SVG_NS, "rect");
      projRect.setAttribute("class", "chart-bar-proj");
      projRect.setAttribute("x", x);
      projRect.setAttribute("y", projY);
      projRect.setAttribute("width", barW);
      projRect.setAttribute("height", projH - h);
      const projTitle = document.createElementNS(SVG_NS, "title");
      projTitle.textContent = `${year} projected: ${projection.projected} (based on ${val} citations in ${projection.elapsedDays} days)`;
      projRect.appendChild(projTitle);
      svg.appendChild(projRect);

      // Projected-value label above the projection overhang, if room.
      if (projH - h > 10) {
        const projLabel = document.createElementNS(SVG_NS, "text");
        projLabel.setAttribute("class", "chart-tooltip chart-proj-label");
        projLabel.setAttribute("x", x + barW / 2);
        projLabel.setAttribute("y", projY - 2);
        projLabel.setAttribute("text-anchor", "middle");
        projLabel.textContent = `~${projection.projected}`;
        svg.appendChild(projLabel);
      }
    }

    const bar = document.createElementNS(SVG_NS, "rect");
    bar.setAttribute("class", "chart-bar");
    bar.setAttribute("x", x);
    bar.setAttribute("y", y);
    bar.setAttribute("width", barW);
    bar.setAttribute("height", h);
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${year}: ${val}`;
    bar.appendChild(title);
    svg.appendChild(bar);

    // Year label under every other bar when there are many years, else under all.
    if (years.length <= 12 || i % 2 === 0 || i === years.length - 1) {
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "chart-axis-label");
      label.setAttribute("x", x + barW / 2);
      label.setAttribute("y", height - 8);
      label.setAttribute("text-anchor", "middle");
      label.textContent = String(year).slice(-2);
      svg.appendChild(label);
    }

    // Actual-value label above bar if it fits (skip for the projection year — the
    // projected label above the overhang is what matters there).
    if (val > 0 && h > 12 && !(projection && i === projection.idx)) {
      const valLabel = document.createElementNS(SVG_NS, "text");
      valLabel.setAttribute("class", "chart-tooltip");
      valLabel.setAttribute("x", x + barW / 2);
      valLabel.setAttribute("y", y - 2);
      valLabel.setAttribute("text-anchor", "middle");
      valLabel.textContent = String(val);
      svg.appendChild(valLabel);
    }
  });

  container.appendChild(svg);
}

export function renderSparkline(container, history, { width = 80, height = 20 } = {}) {
  container.innerHTML = "";
  const pts = (history || []).filter((p) => typeof p.count === "number");
  if (pts.length < 2) return;

  const values = pts.map((p) => p.count);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = Math.max(1, maxV - minV);

  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const x = (i) => pad + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const y = (v) => pad + innerH - ((v - minV) / range) * innerH;

  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(" ");
  const area = `${path} L${x(pts.length - 1).toFixed(1)},${pad + innerH} L${x(0).toFixed(1)},${pad + innerH} Z`;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "chart-svg");
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

export function renderHIndexChart(container, totalsHistory) {
  container.innerHTML = "";
  const history = (totalsHistory || []).filter((p) => typeof p.h_index === "number");
  if (history.length < 2) return;

  const width = 320;
  const height = 110;
  const pad = { top: 12, right: 28, bottom: 22, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const allVals = history.map((p) => p.h_index);
  const recentVals = history.map((p) => p.h_index_recent).filter((v) => typeof v === "number");
  const maxV = Math.max(...allVals, ...recentVals, 1);
  const minV = Math.min(...allVals, ...recentVals, 0);
  const range = Math.max(1, maxV - minV);

  const x = (i) => pad.left + (history.length === 1 ? innerW / 2 : (i / (history.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - ((v - minV) / range) * innerH;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "chart-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "h-index over time");

  function drawLine(values, className, endLabel) {
    const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const line = document.createElementNS(SVG_NS, "path");
    line.setAttribute("class", className);
    line.setAttribute("d", d);
    svg.appendChild(line);

    const lastI = values.length - 1;
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("class", "hindex-dot");
    dot.setAttribute("cx", x(lastI));
    dot.setAttribute("cy", y(values[lastI]));
    dot.setAttribute("r", 2);
    svg.appendChild(dot);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "hindex-label");
    label.setAttribute("x", x(lastI) + 4);
    label.setAttribute("y", y(values[lastI]) + 3);
    label.textContent = `${endLabel}: ${values[lastI]}`;
    svg.appendChild(label);
  }

  drawLine(allVals, "hindex-line", "all");
  if (recentVals.length === history.length) {
    drawLine(recentVals, "hindex-line recent", "recent");
  }

  // X-axis: first and last date.
  const dateLabels = document.createElementNS(SVG_NS, "g");
  const first = document.createElementNS(SVG_NS, "text");
  first.setAttribute("class", "chart-axis-label");
  first.setAttribute("x", pad.left);
  first.setAttribute("y", height - 6);
  first.textContent = history[0].date;
  dateLabels.appendChild(first);

  const last = document.createElementNS(SVG_NS, "text");
  last.setAttribute("class", "chart-axis-label");
  last.setAttribute("x", pad.left + innerW);
  last.setAttribute("y", height - 6);
  last.setAttribute("text-anchor", "end");
  last.textContent = history[history.length - 1].date;
  dateLabels.appendChild(last);
  svg.appendChild(dateLabels);

  container.appendChild(svg);
}
