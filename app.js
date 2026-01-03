// Leaflet OSINT map with clustering + date slider + event-type filters
// Supports GeoJSON FeatureCollection OR a single Feature at root.

const map = L.map("map", { preferCanvas: true }).setView([12, 0], 5);

// Basemap (free OSM)
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

// DOM
const fromRangeEl = document.getElementById("fromRange");
const toRangeEl = document.getElementById("toRange");
const fromLabelEl = document.getElementById("fromLabel");
const toLabelEl = document.getElementById("toLabel");
const typesEl = document.getElementById("types");
const resetBtn = document.getElementById("resetFilters");
const fitBtn = document.getElementById("fitToData");

let rawFeatures = [];
let availableDates = [];
let selectedTypes = new Set();
let allTypes = [];

// Clustering
const clusters = L.markerClusterGroup({
  chunkedLoading: true,
  chunkInterval: 50,
  chunkDelay: 25,
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  disableClusteringAtZoom: 10,
});
clusters.addTo(map);

// Simple deterministic color per type
function colorForType(type) {
  const colors = ["#e74c3c","#f39c12","#f1c40f","#2ecc71","#3498db","#9b59b6","#1abc9c","#e67e22"];
  const s = String(type || "Event");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Robust timestamp getter
function getMs(feature) {
  const p = feature?.properties || {};

  // Preferred: numeric ms
  if (typeof p.event_date_ms === "number") return p.event_date_ms;

  // Sometimes numbers come through as strings
  if (typeof p.event_date_ms === "string") {
    const n = Number(p.event_date_ms);
    if (Number.isFinite(n)) return n;
  }

  // Fallback: ISO date string
  if (typeof p.event_date === "string") {
    // Prefer YYYY-MM-DD (safe across locales)
    const t = Date.parse(p.event_date);
    if (!Number.isNaN(t)) return t;

    // If someone exports DD/MM/YYYY, we can optionally try to parse it:
    // Uncomment if your data is definitely DD/MM/YYYY
    /*
    const m = p.event_date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
      const tt = Date.UTC(yyyy, mm - 1, dd);
      if (!Number.isNaN(tt)) return tt;
    }
    */
  }

  return null;
}

function buildPopupHTML(p) {
  const safe = (v) => (v === null || v === undefined) ? "" : String(v);
  const parts = [];
  parts.push(`<div style="font:14px/1.3 system-ui,Segoe UI,Roboto,Arial">`);
  parts.push(`<div style="font-weight:700; font-size:15px;">${safe(p.event_type || "Event")}</div>`);
  if (p.event_date) parts.push(`<div>${safe(p.event_date)}</div>`);
  if (p.fatalities !== undefined) parts.push(`<div><b>Fatalities:</b> ${safe(p.fatalities)}</div>`);
  if (p.actor1 || p.actor2) parts.push(`<div><b>Actors:</b> ${safe(p.actor1)}${p.actor2 ? " → " + safe(p.actor2) : ""}</div>`);
  if (p.country || p.admin1 || p.location) {
    parts.push(`<div><b>Location:</b> ${[p.location, p.admin1, p.country].filter(Boolean).map(safe).join(", ")}</div>`);
  }
  if (p.notes) parts.push(`<hr style="border:0;border-top:1px solid #ddd;margin:8px 0">`);
  if (p.notes) parts.push(`<div style="white-space:pre-wrap">${safe(p.notes)}</div>`);
  parts.push(`</div>`);
  return parts.join("");
}

function buildMarker(feature) {
  const c = feature?.geometry?.coordinates;
  if (!Array.isArray(c) || c.length !== 2) return null;

  const [lon, lat] = c;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const p = feature.properties || {};
  const ty = String(p.event_type || "Event");

  const marker = L.circleMarker([lat, lon], {
    radius: 5,
    weight: 1,
    color: "#222",
    fillColor: colorForType(ty),
    fillOpacity: 0.85,
  });

  marker.bindPopup(buildPopupHTML(p), { maxWidth: 360 });
  return marker;
}

function rebuildTypeUI() {
  typesEl.innerHTML = "";
  for (const ty of allTypes) {
    const id = "ty_" + ty.replace(/[^a-z0-9]+/gi, "_");
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" id="${id}"><span>${ty}</span>`;
    typesEl.appendChild(label);

    const cb = label.querySelector("input");
    cb.checked = selectedTypes.has(ty);

    cb.addEventListener("change", () => {
      if (cb.checked) selectedTypes.add(ty);
      else selectedTypes.delete(ty);
      applyFilters();
    });
  }
}

function applyFilters() {
  if (!rawFeatures.length || availableDates.length < 1) {
    clusters.clearLayers();
    fromLabelEl.textContent = "No dates";
    toLabelEl.textContent = "No dates";
    return;
  }

  const fromMs = availableDates[Number(fromRangeEl.value)] ?? availableDates[0];
  const toMs = availableDates[Number(toRangeEl.value)] ?? availableDates[availableDates.length - 1];

  fromLabelEl.textContent = fmtDate(fromMs);
  toLabelEl.textContent = fmtDate(toMs);

  clusters.clearLayers();

  const typeFiltering = selectedTypes.size > 0;
  let added = 0;

  for (const f of rawFeatures) {
    const ms = getMs(f);
    if (ms === null) continue;
    if (ms < fromMs || ms > toMs) continue;

    const ty = String(f.properties?.event_type || "Event");
    if (typeFiltering && !selectedTypes.has(ty)) continue;

    const marker = buildMarker(f);
    if (!marker) continue;

    clusters.addLayer(marker);
    added++;
  }

  console.log(`[map] Rendered ${added} features (of ${rawFeatures.length} total after filters).`);
}

// Fit map to currently displayed layers
function fitToClusters() {
  const layers = clusters.getLayers();
  if (!layers.length) return;
  const bounds = L.featureGroup(layers).getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
}

async function loadData() {
  const url = "./events.geojson?v=" + Date.now(); // avoid stale cache
  console.log("[map] Fetching:", url);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load events.geojson (${res.status})`);

  const geojson = await res.json();

  // ✅ Support FeatureCollection OR single Feature
  rawFeatures = Array.isArray(geojson.features)
    ? geojson.features
    : (geojson?.type === "Feature" ? [geojson] : []);

  console.log("[map] Loaded features:", rawFeatures.length);

  // Build dates + types
  const datesSet = new Set();
  const typesSet = new Set();

  for (const f of rawFeatures) {
    const ms = getMs(f);
    if (typeof ms === "number") datesSet.add(ms);

    const ty = f.properties?.event_type;
    if (ty) typesSet.add(String(ty));
  }

  availableDates = Array.from(datesSet).sort((a, b) => a - b);
  allTypes = Array.from(typesSet).sort((a, b) => a.localeCompare(b));

  console.log("[map] Distinct dates:", availableDates.length, "Distinct types:", allTypes.length);

  // Sliders
  if (availableDates.length >= 1) {
    fromRangeEl.min = 0;
    fromRangeEl.max = availableDates.length - 1;
    fromRangeEl.value = 0;

    toRangeEl.min = 0;
    toRangeEl.max = availableDates.length - 1;
    toRangeEl.value = availableDates.length - 1;

    fromRangeEl.oninput = () => {
      if (+fromRangeEl.value > +toRangeEl.value) fromRangeEl.value = toRangeEl.value;
      applyFilters();
    };

    toRangeEl.oninput = () => {
      if (+toRangeEl.value < +fromRangeEl.value) toRangeEl.value = fromRangeEl.value;
      applyFilters();
    };
  } else {
    fromLabelEl.textContent = "No dates";
    toLabelEl.textContent = "No dates";
  }

  // Types UI
  selectedTypes = new Set(); // default: show all
  rebuildTypeUI();

  // Initial render + fit
  applyFilters();
  fitToClusters();

  // Buttons
  resetBtn.onclick = () => {
    selectedTypes.clear();
    Array.from(typesEl.querySelectorAll('input[type="checkbox"]')).forEach(cb => cb.checked = false);
    if (availableDates.length) {
      fromRangeEl.value = 0;
      toRangeEl.value = availableDates.length - 1;
    }
    applyFilters();
    fitToClusters();
  };

  fitBtn.onclick = () => {
    fitToClusters();
  };
}

loadData().catch((err) => {
  console.error(err);
  alert("Failed to load events.geojson. Open DevTools Console for details.");
});
