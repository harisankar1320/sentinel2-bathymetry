/* Crete bathymetry page: depth map viewer and two small charts.
   Map layers come from data/meta.json + data/*.webp (written by the export cell in the notebook).
   Chart numbers are copied from the notebook outputs. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}

/* ---------------------------------------------------------------- notebook numbers */
// Mean ln(B03) of the per-pixel median, per 2 m depth bin (0-2, 2-4, ... 28-30 m)
const SIGNAL = [-2.813, -3.037, -3.181, -3.349, -3.439, -3.536, -3.62, -3.71, -3.785, -3.823, -3.791, -3.81, -3.82, -3.813, -3.816];
// Error by depth bin on the held-out pixels: [bin, n, rfBias, rfMAE, mlpBias, mlpMAE, mlpMedian]
const BINS = [
  ["0–3 m", 196087, 3.28, 3.41, 3.29, 3.37, 1.70],
  ["3–6 m", 429360, 1.72, 2.25, 1.70, 2.16, 1.41],
  ["6–9 m", 394816, 0.90, 1.93, 0.91, 1.82, 1.59],
  ["9–12 m", 448196, -0.57, 1.54, -0.52, 1.28, 0.96],
  ["12–15 m", 529361, -2.96, 2.99, -2.86, 2.87, 2.71],
];
const sgn = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2);

/* ---------------------------------------------------------------- map */
let map, overlay, meta, current;

async function initMap() {
  map = L.map("map", { zoomSnap: 0.25, scrollWheelZoom: false });
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 18, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
  }).addTo(map);
  map.attributionControl.addAttribution("Contains modified Copernicus Sentinel data; EMODnet Bathymetry");
  map.setView([35.4, 23.6], 9);
  map.on("click focus", () => map.scrollWheelZoom.enable());

  if (location.protocol === "file:") return showEmpty("<p>Browsers block the map data when the page is opened straight from disk.</p><p>In this folder run <code>python -m http.server</code> and open <code>http://localhost:8000</code>.</p>");
  try {
    const r = await fetch("data/meta.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    meta = await r.json();
  } catch (e) {
    return showEmpty("<p>No map data in <code>docs/data/</code> yet.</p><p>Run the export cell at the end of the bathymetry notebook, then reload.</p>");
  }
  map.fitBounds(meta.focus || meta.bounds, { padding: [10, 10] });

  const box = $("#layer-switch");
  for (const l of meta.layers) {                         // one radio button per layer
    const lab = el("label"), inp = el("input", { type: "radio", name: "layer", value: l.id });
    inp.checked = l === meta.layers[0];
    inp.addEventListener("change", () => setLayer(l));
    lab.append(inp, el("span", {}, l.label));
    box.append(lab);
  }
  box.hidden = false;
  $("#opacity-box").hidden = false;
  $("#opacity").addEventListener("input", (e) => overlay && overlay.setOpacity(e.target.value / 100));
  setLayer(meta.layers[0]);
}

function setLayer(l) {
  current = l;
  const op = $("#opacity").value / 100;
  if (overlay) overlay.setUrl(`data/${l.file}`);
  else overlay = L.imageOverlay(`data/${l.file}`, meta.bounds, { opacity: op, interactive: false, alt: "" }).addTo(map);
  // legend: title, unit, colour bar, end and middle ticks
  const [lo, hi] = l.range, lg = $("#legend");
  const bar = el("div", { class: "legend__bar" });
  bar.style.background = `linear-gradient(90deg, ${l.ramp.join(", ")})`;
  const ticks = el("div", { class: "legend__ticks" });
  const f = (v) => (l.kind === "diverging" ? sgn(v).replace(".00", "") : v) + " m";
  ticks.append(el("span", {}, f(lo)), el("span", {}, f((lo + hi) / 2)), el("span", {}, f(hi)));
  lg.replaceChildren(el("div", { class: "legend__title" }, l.title), el("div", { class: "legend__sub" }, l.sub), bar, ticks);
}

function showEmpty(html) {
  const b = $("#empty");
  b.innerHTML = `<div>${html}</div>`;
  b.hidden = false;
}

/* ---------------------------------------------------------------- tooltip */
function tip(title, rows, cx, cy) {                       // rows: [{color, value, label}]
  const t = $("#tooltip");
  t.replaceChildren(el("div", { class: "tooltip__date" }, title));
  for (const r of rows) {
    const row = el("div", { class: "tooltip__row" });
    if (r.color) { const k = el("span", { class: "key" }); k.style.color = r.color; row.append(k); }
    row.append(el("strong", {}, r.value), el("span", {}, r.label));
    t.append(row);
  }
  t.hidden = false;
  t.style.left = `${Math.min(cx + 14, innerWidth - t.offsetWidth - 8)}px`;
  t.style.top = `${Math.max(8, cy - t.offsetHeight - 12)}px`;
}
const hideTip = () => ($("#tooltip").hidden = true);

/* ---------------------------------------------------------------- chart 1: signal vs depth */
function drawSignal() {
  const box = $("#signal"), W = Math.max(box.clientWidth, 280), H = 240, M = { l: 48, r: 12, t: 16, b: 34 };
  const x = (d) => M.l + (d / 30) * (W - M.l - M.r);
  const [y0, y1] = [-4, -2.6], y = (v) => M.t + ((y1 - v) / (y1 - y0)) * (H - M.t - M.b);
  const pts = SIGNAL.map((v, i) => [i * 2 + 1, v]);      // bin centres 1, 3, ... 29 m

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Green reflectance falls with depth down to about 18 m, then stays flat.">`;
  s += `<g class="grid">`;
  for (let v = -4; v <= -2.6 + 1e-9; v += 0.2) s += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}"/>`;
  s += `</g><g class="axis">`;
  for (let v = -4; v <= -2.6 + 1e-9; v += 0.4) s += `<text x="${M.l - 8}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1).replace("-", "−")}</text>`;
  for (let d = 0; d <= 30; d += 5) s += `<text x="${x(d)}" y="${H - 14}" text-anchor="middle">${d}</text>`;
  s += `<text x="${W - M.r}" y="${H - 1}" text-anchor="end">EMODnet depth (m)</text></g>`;
  // modelled range 0-15 m, with a direct label
  s += `<rect x="${x(0)}" y="${M.t}" width="${x(15) - x(0)}" height="${H - M.t - M.b}" fill="var(--race)"/>`;
  s += `<text x="${x(15) - 6}" y="${M.t + 12}" text-anchor="end" fill="var(--muted)" font-size="11">modelled range</text>`;
  s += `<path d="${pts.map(([d, v], i) => `${i ? "L" : "M"}${x(d)},${y(v)}`).join("")}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
  for (const [d, v] of pts) s += `<circle cx="${x(d)}" cy="${y(v)}" r="4" fill="var(--accent)" stroke="var(--paper)" stroke-width="2"/>`;
  s += `<line class="xhair" y1="${M.t}" y2="${H - M.b}" stroke="var(--muted)" visibility="hidden"/>`;
  s += `<rect class="hit" x="${M.l}" y="0" width="${W - M.l - M.r}" height="${H}" fill="transparent"/></svg>`;

  const fig = el("figure", { class: "chart" });
  fig.style.margin = "0";
  fig.append(el("div", { class: "chart__head" }, ""));
  fig.firstChild.append(el("h3", { class: "chart__title" }, "Green reflectance, ln(B03), against depth"));
  fig.insertAdjacentHTML("beforeend", s);
  box.replaceChildren(fig);

  const svg = fig.querySelector("svg"), hair = svg.querySelector(".xhair");
  svg.querySelector(".hit").addEventListener("pointermove", (ev) => {
    const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(14, Math.round(((sx - M.l) / (W - M.l - M.r)) * 30 / 2 - 0.5)));
    hair.setAttribute("x1", x(pts[i][0])); hair.setAttribute("x2", x(pts[i][0])); hair.setAttribute("visibility", "visible");
    tip(`${i * 2}–${i * 2 + 2} m`, [{ color: "var(--accent)", value: pts[i][1].toFixed(2).replace("-", "−"), label: "mean ln(B03)" }], ev.clientX, ev.clientY);
  });
  svg.querySelector(".hit").addEventListener("pointerleave", () => { hair.setAttribute("visibility", "hidden"); hideTip(); });
}

/* ---------------------------------------------------------------- chart 2: bias by depth */
function drawBias() {
  const box = $("#bias"), W = Math.max(box.clientWidth, 280), H = 250, M = { l: 44, r: 12, t: 12, b: 30 };
  const lim = 4, y = (v) => M.t + ((lim - v) / (2 * lim)) * (H - M.t - M.b);
  const bw = (W - M.l - M.r) / BINS.length, bar = Math.min(28, bw * 0.3), gap = 2;
  const series = [["Random forest", 2, "var(--rf)"], ["Neural network", 4, "var(--mlp)"]];

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Mean error by depth: too deep in shallow water, too shallow beyond 12 m, for both models.">`;
  s += `<g class="grid">`;
  for (let v = -lim; v <= lim; v += 1) s += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}"/>`;
  s += `</g><g class="axis">`;
  for (let v = -lim; v <= lim; v += 2) s += `<text x="${M.l - 8}" y="${y(v) + 4}" text-anchor="end">${v > 0 ? "+" : ""}${String(v).replace("-", "−")} m</text>`;
  BINS.forEach((b, i) => (s += `<text x="${M.l + bw * (i + 0.5)}" y="${H - 8}" text-anchor="middle">${b[0]}</text>`));
  s += `</g>`;
  BINS.forEach((b, i) => series.forEach(([, k, c], j) => {
    const cx = M.l + bw * (i + 0.5) + (j ? gap / 2 : -bar - gap / 2), v = b[k];
    const top = Math.min(y(v), y(0)), h = Math.abs(y(v) - y(0));
    // bar with the rounded end away from the zero line
    s += `<path d="${roundedBar(cx, top, bar, h, v >= 0)}" fill="${c}"/>`;
  }));
  s += `<line class="baseline" x1="${M.l}" x2="${W - M.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  s += `<text x="${W - M.r}" y="${y(lim) + 12}" text-anchor="end" fill="var(--muted)" font-size="11">predicts too deep ↑</text>`;
  s += `<text x="${W - M.r}" y="${y(-lim) - 4}" text-anchor="end" fill="var(--muted)" font-size="11">predicts too shallow ↓</text>`;
  BINS.forEach((_, i) => (s += `<rect class="hit" data-i="${i}" x="${M.l + bw * i}" y="0" width="${bw}" height="${H}" fill="transparent"/>`));
  s += `</svg>`;

  const fig = el("figure", { class: "chart" });
  fig.style.margin = "0";
  const head = el("div", { class: "chart__head" }), legend = el("ul", { class: "chart__legend" });
  head.append(el("h3", { class: "chart__title" }, "Mean error (bias) by depth, held-out blocks"));
  for (const [name, , c] of series) {
    const li = el("li"), k = el("span", { class: "key key--box" });
    k.style.background = c; li.append(k, document.createTextNode(name)); legend.append(li);
  }
  head.append(legend); fig.append(head);
  fig.insertAdjacentHTML("beforeend", s);
  box.replaceChildren(fig);

  fig.querySelectorAll(".hit").forEach((h) => {
    h.addEventListener("pointermove", (ev) => {
      const b = BINS[+h.dataset.i];
      tip(b[0], series.map(([name, k, c]) => ({ color: c, value: `${sgn(b[k])} m`, label: name })), ev.clientX, ev.clientY);
    });
    h.addEventListener("pointerleave", hideTip);
  });
}
function roundedBar(x, y, w, h, up) {
  const r = Math.min(4, h, w / 2);
  return up
    ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
    : `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
}

function fillTable() {
  $("#bias-table").innerHTML = BINS.map((b) =>
    `<tr><th scope="row">${b[0]}</th><td>${b[1].toLocaleString("en-GB")}</td><td>${sgn(b[2])}</td><td>${b[3].toFixed(2)}</td><td>${sgn(b[4])}</td><td>${b[5].toFixed(2)}</td><td>${b[6].toFixed(2)}</td></tr>`).join("");
}

/* ---------------------------------------------------------------- start */
initMap();
fillTable();
drawSignal(); drawBias();
new ResizeObserver(() => { drawSignal(); drawBias(); }).observe($("#signal"));
