// Assumes your GeoJSON features have properties:
// event_date (YYYY-MM-DD), event_date_ms (number), event_type (string), plus optional notes/actors/fatalities.

const viewer = new Cesium.Viewer("cesiumContainer", {
  imageryProvider: new Cesium.OpenStreetMapImageryProvider(),
  baseLayerPicker: false,
  geocoder: false,
  homeButton: true,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  // Small perf wins:
  requestRenderMode: true, // render only when needed (big heat/CPU win)
  maximumRenderTimeChange: Infinity,
});

viewer.scene.globe.depthTestAgainstTerrain = false;

// --- Performance / heat optimizations ---
viewer.scene.requestRenderMode = true;
viewer.scene.maximumRenderTimeChange = Infinity;

// Lower GPU load on HiDPI screens (try 0.7 if still hot)
viewer.resolutionScale = 0.75;

// Turn off a few expensive effects that aren't needed for an OSINT point map
viewer.scene.fxaa = false;
viewer.scene.fog.enabled = false;
viewer.scene.globe.enableLighting = false;
viewer.scene.globe.showGroundAtmosphere = false;
viewer.scene.skyAtmosphere.show = false;

// If you want even less GPU usage, uncomment to force 2D:
// viewer.scene.mode = Cesium.SceneMode.SCENE2D;

// Center roughly on West Africa
viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(0, 12, 2500000),
});

// Cache DOM lookups (small but clean)
const fromRangeEl = document.getElementById("fromRange");
const toRangeEl = document.getElementById("toRange");
const fromLabelEl = document.getElementById("fromLabel");
const toLabelEl = document.getElementById("toLabel");
const typesEl = document.getElementById("types");

let dataSource;
let allEntities = [];
let availableDates = [];
let selectedTypes = new Set();
let typeCheckboxes = new Map();

function fmtDate(ms) {
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

function applyFilters() {
  if (!availableDates.length || !allEntities.length) return;

  const fromMs = availableDates[Number(fromRangeEl.value)];
  const toMs = availableDates[Number(toRangeEl.value)];

  fromLabelEl.textContent = fmtDate(fromMs);
  toLabelEl.textContent = fmtDate(toMs);

  // Filter entities
  for (const e of allEntities) {
    const t = e.properties?.event_date_ms?.getValue();
    const ty = e.properties?.event_type?.getValue();

    const passDate = (typeof t === "number" && t >= fromMs && t <= toMs);
    const passType = (selectedTypes.size === 0) ? true : selectedTypes.has(ty);

    e.show = passDate && passType;
  }

  // In requestRenderMode, we must ask Cesium to redraw after changes
  viewer.scene.requestRender();
}

function buildTypeUI(types) {
  typesEl.innerHTML = "";
  typeCheckboxes.clear();

  for (const ty of types) {
    const id = "ty_" + ty.replace(/[^a-z0-9]+/gi, "_");
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" id="${id}"><span>${ty}</span>`;
    typesEl.appendChild(label);

    const cb = label.querySelector("input");
    cb.addEventListener("change", () => {
      if (cb.checked) selectedTypes.add(ty);
      else selectedTypes.delete(ty);
      applyFilters();
    });

    typeCheckboxes.set(ty, cb);
  }

  viewer.scene.requestRender();
}

async function main() {
  // Cache-bust during development (optional). Comment out once stable.
  // const url = "./events.geojson?v=" + Date.now();
  const url = "./events.geojson";

  // Load GeoJSON
  dataSource = await Cesium.GeoJsonDataSource.load(url, {
    clampToGround: true,
  });
  viewer.dataSources.add(dataSource);

  // Clustering helps a LOT when zoomed out (less visual clutter + less work)
  dataSource.clustering.enabled = true;
  dataSource.clustering.pixelRange = 40;
  dataSource.clustering.minimumClusterSize = 6;

  allEntities = dataSource.entities.values;

  // Build popup (InfoBox) content
  for (const e of allEntities) {
    const props = e.properties;
    const eventType = props?.event_type?.getValue() ?? "Event";
    const date = props?.event_date?.getValue() ?? "";
    const fatalities = props?.fatalities?.getValue();
    const actor1 = props?.actor1?.getValue();
    const actor2 = props?.actor2?.getValue();
    const notes = props?.notes?.getValue();

    e.name = eventType;
    e.description = `
      <div style="font-family:system-ui,Segoe UI,Roboto,Arial; font-size:14px;">
        <div><b>${eventType}</b></div>
        <div>${date}</div>
        ${fatalities !== undefined ? `<div><b>Fatalities:</b> ${fatalities}</div>` : ""}
        ${(actor1 || actor2) ? `<div><b>Actors:</b> ${(actor1 ?? "")} ${actor2 ? "→ " + actor2 : ""}</div>` : ""}
        ${notes ? `<hr><div style="white-space:pre-wrap;">${notes}</div>` : ""}
      </div>
    `;
  }

  // Build date index + type list
  const datesSet = new Set();
  const typesSet = new Set();

  for (const e of allEntities) {
    const t = e.properties?.event_date_ms?.getValue();
    const ty = e.properties?.event_type?.getValue();
    if (typeof t === "number") datesSet.add(t);
    if (ty) typesSet.add(ty);
  }

  availableDates = Array.from(datesSet).sort((a, b) => a - b);
  const types = Array.from(typesSet).sort((a, b) => a.localeCompare(b));

  if (availableDates.length < 2) {
    console.warn("Not enough distinct dates for range filter. Add event_date_ms to GeoJSON.");
    // Still render something if present
    viewer.scene.requestRender();
    return;
  }

  // Slider setup (indexes into availableDates)
  fromRangeEl.min = 0;
  fromRangeEl.max = availableDates.length - 1;
  fromRangeEl.value = 0;

  toRangeEl.min = 0;
  toRangeEl.max = availableDates.length - 1;
  toRangeEl.value = availableDates.length - 1;

  fromRangeEl.addEventListener("input", () => {
    if (Number(fromRangeEl.value) > Number(toRangeEl.value)) fromRangeEl.value = toRangeEl.value;
    applyFilters();
  });

  toRangeEl.addEventListener("input", () => {
    if (Number(toRangeEl.value) < Number(fromRangeEl.value)) toRangeEl.value = fromRangeEl.value;
    applyFilters();
  });

  buildTypeUI(types);
  applyFilters();

  // Optional: zoom to your data once it loads (nice UX + ensures you see points)
  // viewer.flyTo(dataSource);

  viewer.scene.requestRender();
}

main().catch(console.error);
