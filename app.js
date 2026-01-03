// Expected GeoJSON feature properties:
// event_date: "YYYY-MM-DD" (string)
// event_date_ms: number (unix ms)  <-- strongly recommended for fast filtering
// event_type: string
// optional: fatalities, actor1, actor2, notes, country, admin1, location

const map = L.map("map", { preferCanvas: true }).setView([12, 0], 5);

// Free OSM basemap (no key)
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
}).addTo(map);

const fromRangeEl = document.getElementById("fromRange");
const toRangeEl = document.getElementById("toRange");
const fromLabelEl = document.getElementById("fromLabel");
const toLabelEl = document.getElementById("toLabel");
const typesEl = document.getElementById("types");
const resetBtn = document.getElementById("resetFilters");
const fitBtn = document.getElementById("fitToData");

let rawFeatures = [];          // original features
let availableDates = [];       // sorted unique ms timestamps
let selectedTypes = new Set(); // active type filters

// Cluster group (fast + tidy)
const clusters = L.markerClusterGroup({
  chunkedLoading: true,     // prevents UI freezing while adding markers
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  disableClusteringAtZoom: 10,
});

clusters.addTo(map);

// Color palette by event type (simple deterministic hash)
function colorForType(type) {
  const colors = ["#e74c3c","#f39c12","#f1c40f","#2ecc71","#3498db","#9b59b6","#1abc9c","#e67e22"];
  let h = 0;
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function getMs(feature) {
  const p = feature.properties || {};
  if (typeof p.event_date_ms === "number") return p.event_date_ms;

  // Fallback: parse event_date if ms missing
  // (Works, but better to provide event_date_ms in your export)
  if (typeof p.event_date === "string") {
    const d = new Date(p.event_date);
    const t = d.getTime();
    if (!Number.isNaN(t)) return t;
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

function rebuildTypeUI(types) {
  typesEl.innerHTML = "";

  types.forEach((ty) => {
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
  });
}

function buildMarker(feature) {
  const [lon, lat] = feature.geometry.coordinates; // GeoJSON is [lon, lat]
  const p = feature.properties || {};
  const ty = String(p.event_type || "Event");

  // Lightweight circle marker (very fast)
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

function applyFilters() {
  if (!rawFeatures.length || availableDates.length < 2) return;

  const fromMs = availableDates[Number(fromRangeEl.value)];
  const toMs = availableDates[Number(toRangeEl.value)];

  fromLabelEl.textContent = fmtDate(fromMs);
  toLabelEl.textContent = fmtDate(toMs);

  // Clear and rebuild clusters (5k is fine; chunkedLoading keeps it smooth)
  clusters.clearLayers();

  const typeFiltering = selectedTypes.size > 0;

  for (const f of rawFeatures) {
    const ms = getMs(f);
    if (ms === null) continue;

    if (ms < fromMs || ms > toMs) continue;

    const ty = String(f.properties?.event_type || "Event");
    if (typeFiltering && !selectedTypes.has(ty)) continue;

    clusters.addLayer(buildMarker(f));
  }
}

async function loadData() {
  // Cache-bust during updates so users don’t see stale data
  const url = "./events.geojson?v=" + Date.now();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load events.geojson (${res.status})`);
  const geojson = await res.json();

  rawFeatures = geojson.features || [];

  // Build dates + types sets
  const datesSet = new Set();
  const typesSet = new Set();

  for (const f of rawFeatures) {
    const ms = getMs(f);
    if (typeof ms === "number") datesSet.add(ms);

    const ty = f.properties?.event_type;
    if (ty) typesSet.add(String(ty));
  }

  availableDates = Array.from(datesSet).sort((a, b) => a - b);
  const types = Array.from(typesSet).sort((a, b) => a.localeCompare(b));

  if (availableDates.length < 2) {
    fromLabelEl.textContent = "No dates";
    toLabelEl.textContent = "No dates";
  } else {
    fromRangeEl.min = 0;
    fromRangeEl.max = availableDates.length - 1;
    fromRangeEl.value = 0;

    toRangeEl.min = 0;
    toRangeEl.max = availableDates.length - 1;
    toRangeEl.value = availableDates.length - 1;

    fromRangeEl.addEventListener("input", () => {
      if (+fromRangeEl.value > +toRangeEl.value) fromRangeEl.value = toRangeEl.value;
      applyFilters();
    });

    toRangeEl.addEventListener("input", () => {
      if (+toRangeEl.value < +fromRangeEl.value) toRangeEl.value = fromRangeEl.value;
      applyFilters();
    });
  }

  // Default: no type filters (show all)
  selectedTypes = new Set();
  rebuildTypeUI(types);

  // Initial render
  applyFilters();

  // Fit map to data
  if (rawFeatures.length) {
    const latlngs = rawFeatures
      .map(f => f.geometry?.coordinates)
      .filter(c => Array.isArray(c) && c.length === 2)
      .map(([lon, lat]) => L.latLng(lat, lon));

    if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
  }

  // Buttons
  resetBtn.onclick = () => {
    selectedTypes.clear();
    // reset checkboxes
    Array.from(typesEl.querySelectorAll("input[type=checkbox]")).forEach(cb => cb.checked = false);
    fromRangeEl.value = 0;
    toRangeEl.value = availableDates.length - 1;
    applyFilters();
  };

  fitBtn.onclick = () => {
    const layers = clusters.getLayers();
    if (!layers.length) return;
    const groupBounds = L.featureGroup(layers).getBounds();
    map.fitBounds(groupBounds, { padding: [40, 40] });
  };
}

loadData().catch((err) => {
  console.error(err);
  alert("Failed to load events.geojson. Check console for details.");
});
