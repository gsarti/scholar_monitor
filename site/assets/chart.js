// Minimal inline-SVG bar chart for citations-per-year.

const SVG_NS = "http://www.w3.org/2000/svg";

export function renderCitationsChart(container, citationsPerYear) {
  container.innerHTML = "";
  const years = Object.keys(citationsPerYear || {})
    .map(Number)
    .filter((y) => !Number.isNaN(y))
    .sort((a, b) => a - b);
  if (!years.length) return;

  const values = years.map((y) => citationsPerYear[String(y)] || 0);
  const maxVal = Math.max(1, ...values);

  const width = 320;
  const height = 150;
  const pad = { top: 12, right: 8, bottom: 22, left: 8 };
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

    // Value label above bar if it fits.
    if (val > 0 && h > 12) {
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
