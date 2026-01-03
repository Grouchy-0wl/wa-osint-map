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
});

viewer.scene.globe.depthTestAgainstTerrain = false;

// Center roughly on West Africa
viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(0, 12, 2500000),
});

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
  const fromMs = availableDates[Number(document.getElementById("fromRange").value)];
  const toMs   = availableDates[Number(document.getElementById("toRange").value)];

  document.getElementById("fromLabel").textContent = fmtDate(fromMs);
  document.getElementById("toLabel").textContent   = fmtDate(toMs);

  for (const e of allEntities) {
    const t = e.properties?.event_date_ms?.getValue();
    const ty = e.properties?.event_type?.getValue();
    const passDate = (typeof t === "number" && t >= fromMs && t <= toMs);
    const passType = (selectedTypes.size === 0) ? true : selectedTypes.has(ty);
    e.show = passDate && passType;
  }
}

function buildTypeUI(types) {
  const container = document.getElementById("types");
  container.innerHTML = "";
  typeCheckboxes.clear();

  for (const ty of types) {
    const id = "ty_" + ty.replace(/[^a-z0-9]+/gi, "_");
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" id="${id}"><span>${ty}</span>`;
    container.appendChild(label);

    const cb = label.querySelector("input");
    cb.addEventListener("change", () => {
      if (cb.checked) selectedTypes.add(ty);
      else selectedTypes.delete(ty);
      applyFilters();
    });
    typeCheckboxes.set(ty, cb);
  }
}

async function main() {
  // Load GeoJSON (Cesium supports GeoJsonDataSource.load)
  dataSource = await Cesium.GeoJsonDataSource.load("./events.geojson", {
    clampToGround: true,
  });
  viewer.dataSources.add(dataSource);

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

  availableDates = Array.from(datesSet).sort((a,b) => a - b);
  const types = Array.from(typesSet).sort((a,b) => a.localeCompare(b));

  if (availableDates.length < 2) {
    console.warn("Not enough distinct dates for range filter. Add event_date_ms to GeoJSON.");
    return;
  }

  // Slider setup (indexes into availableDates)
  const from = document.getElementById("fromRange");
  const to = document.getElementById("toRange");

  from.min = 0; from.max = availableDates.length - 1; from.value = 0;
  to.min = 0;   to.max = availableDates.length - 1;   to.value = availableDates.length - 1;

  from.addEventListener("input", () => {
    if (Number(from.value) > Number(to.value)) from.value = to.value;
    applyFilters();
  });
  to.addEventListener("input", () => {
    if (Number(to.value) < Number(from.value)) to.value = from.value;
    applyFilters();
  });

  buildTypeUI(types);
  applyFilters();
}

main().catch(console.error);
