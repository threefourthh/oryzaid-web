// js/drawmap/geoman_planner.js
import { showCenterNotif } from "./center_notif.js";

function setStatus(text, state = "planning") {
  const el = document.querySelector("#plannerStatus .value");
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state;
}

function setBtnEnabled(id, on) {
  const b = document.getElementById(id);
  if (b) b.disabled = !on;
}

function updateAreaDisplay(ctx, latlngs) {
  const areaEl = document.getElementById("areaDisplay");
  if (!areaEl) return;

  if (!latlngs || latlngs.length < 3) {
    areaEl.textContent = "Area: 0 ha";
    ctx.state.areaHa = 0; // ✅ NEW
    return;
  }

  const coords = latlngs.map((p) => [p.lng, p.lat]);
  coords.push(coords[0]);

  const poly = turf.polygon([coords]);
  const areaM2 = turf.area(poly);
  const areaHa = areaM2 / 10000;

  areaEl.textContent = `Area: ${areaHa.toFixed(2)} ha`;
  ctx.state.areaHa = areaHa; // ✅ NEW
}

function getPolygonLatLngs(layer) {
  const latlngs = layer.getLatLngs();
  return Array.isArray(latlngs) && Array.isArray(latlngs[0]) ? latlngs[0] : [];
}

/* ✅ This is what Level 2 planner listens to */
function emitPolygonUpdated(ctx, layer, pts) {
  window.dispatchEvent(
    new CustomEvent("maizeeye:polygon-updated", {
      detail: { layer, latlngs: pts },
    })
  );
}

function wirePolygonLayer(ctx, layer) {
  const map = ctx.map;

  function onPolygonChanged() {
    const pts = getPolygonLatLngs(layer);
    ctx.state.polygonLayer = layer;
    ctx.state.polygonLatLngs = pts;

    updateAreaDisplay(ctx, pts);
    emitPolygonUpdated(ctx, layer, pts);

    const ok = pts.length >= 3;
    setBtnEnabled("generatePathBtn", ok);
    setBtnEnabled("exportBtn", false);
    setBtnEnabled("monitorBtn", false);

    setStatus(ok ? "READY" : "PLANNING", ok ? "ready" : "planning");
  }

  // attach listeners
  layer.on("pm:edit", onPolygonChanged);
  layer.on("pm:dragend", onPolygonChanged);

  layer.on("pm:remove", () => {
    ctx.state.polygonLayer = null;
    ctx.state.polygonLatLngs = [];
    updateAreaDisplay(ctx, []);

    setBtnEnabled("generatePathBtn", false);
    setBtnEnabled("exportBtn", false);
    setBtnEnabled("monitorBtn", false);

    setStatus("PLANNING", "planning");

    emitPolygonUpdated(ctx, null, []);
  });

  // initial sync
  onPolygonChanged();
}

/**
 * ✅ Restore saved polygon from ctx.state.polygonLatLngs
 * Call this AFTER initGeomanPlanner(ctx) in app.js
 */
export function restorePolygonFromState(ctx) {
  const map = ctx.map;
  const pts = ctx.state?.polygonLatLngs;

  if (!map || !Array.isArray(pts) || pts.length < 3) return;

  // remove old polygon if any
  if (ctx.state.polygonLayer) {
    try {
      map.removeLayer(ctx.state.polygonLayer);
    } catch {}
    ctx.state.polygonLayer = null;
  }

  // draw polygon
  const layer = L.polygon(pts);
  layer.addTo(map);

  // enable pm editing for this layer
  try {
    layer.pm.enable({ allowSelfIntersection: false });
    layer.pm.disable(); // keep it not "editing" mode by default
  } catch {}

  // wire events and update UI state
  wirePolygonLayer(ctx, layer);

  // zoom to polygon
  try {
    map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  } catch {}
}

export function initGeomanPlanner(ctx) {
  const map = ctx.map;

  map.pm.addControls({
    position: "topleft",
    drawPolygon: true,
    editMode: true,
    dragMode: true,
    removalMode: true,
    cutPolygon: false,

    drawMarker: false,
    drawPolyline: false,
    drawCircle: false,
    drawCircleMarker: false,
    drawRectangle: false,
    drawText: false,
  });

  setStatus("PLANNING", "planning");
  setBtnEnabled("generatePathBtn", false);
  setBtnEnabled("exportBtn", false);
  setBtnEnabled("monitorBtn", false);

  map.on("pm:create", (e) => {
    if (e.shape !== "Polygon") return;

    // only allow 1 polygon
    if (ctx.state.polygonLayer) {
      try {
        map.removeLayer(ctx.state.polygonLayer);
      } catch {}
    }

    const layer = e.layer;
    ctx.state.polygonLayer = layer;

    // wire everything (edit/drag/remove + emit event + enable buttons)
    wirePolygonLayer(ctx, layer);

    showCenterNotif?.("Boundary set. Now click GENERATE PATH.", { okText: "OK" });
  });
}