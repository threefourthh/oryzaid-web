// js/drawmap/app.js
import { initCenterNotif, showCenterConfirm } from "./center_notif.js";
import { initMap } from "./map_init.js";
import {
  exposeLocalMissionsToWindow,
  createNewLocalPlan,
  saveCurrentPlan,
  loadPlanIntoCtx,
  autoNamePlanFromLocation,
} from "./local_plans.js";

// Level 2 modules
import { initGeomanPlanner, restorePolygonFromState } from "./geoman_planner.js";
import { initPathPlannerLevel2, restoreFlightFromState } from "./planner_level2.js";
import { initExportMission } from "./export_mission.js";
import { initMonitorNav } from "./monitor_nav.js";

function setPlanLabel(text) {
  const el = document.getElementById("planLabel");
  if (el) el.textContent = text;
}

function getPlanIdFromURL() {
  const p = new URLSearchParams(location.search);
  return p.get("plan_id");
}

// ----- Save Location (optional, pro flow) -----
async function getBrowserLocationOnce() {
  const TIMEOUT_MS = 8000;

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));

    const t = setTimeout(() => reject(new Error("Location timeout")), TIMEOUT_MS);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(t);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        });
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 0 }
    );
  });
}

// Demo-friendly reverse geocode (OSM). For production, do this in Cloud + cache.
async function reverseGeocodeNominatim(lat, lng) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Reverse geocode failed: HTTP ${res.status}`);

  const data = await res.json();
  const a = data.address || {};

  const brgy = a.suburb || a.village || a.hamlet || a.neighbourhood || "";
  const city = a.city || a.town || a.municipality || a.county || "";
  const province = a.state || "";

  const parts = [];
  if (brgy) parts.push(brgy);
  if (city) parts.push(city);
  if (province) parts.push(province);

  return parts.join(", ") || (data.display_name || "");
}

window.addEventListener("DOMContentLoaded", () => {
  initCenterNotif();
  exposeLocalMissionsToWindow();

  // Make ctx global so ALL modules share the same object
  const ctx = (window.ctx = window.ctx || {});
  ctx.map = initMap({ mapId: "map" });

  // Back button
  document.getElementById("backBtn")?.addEventListener("click", () => {
    window.location.href = "missions.html";
  });

  // Holds runtime state
  ctx.state = ctx.state || {
    polygonLayer: null,
    polygonLatLngs: [],
    flightLayer: null,
    flightWaypoints: [],
    planId: null,
    missionId: null,
    createdAt: null,

    // Location fields
    homeLatLng: null,
    locationLabel: "",

    settings: {
      altitudeM: 20,
      spacingM: 8,
      angleDeg: 90,
    },
  };

  // Load existing plan if opened from missions.html, else create new
  const urlPlanId = getPlanIdFromURL();
  let plan = null;

  if (urlPlanId) {
    plan = loadPlanIntoCtx(ctx, urlPlanId);
  }

  if (!plan) {
    const urlName = getPlanNameFromURL();
    plan = createNewLocalPlan(ctx, { name: urlName });
  }

  const name = ctx.state.planName || "";
  setPlanLabel(name ? `PLAN ${plan.plan_id} • ${name}` : `PLAN ${plan.plan_id}`);

  function refreshPlanLabel(ctx) {
    const currentName = (ctx.state.planName || "").trim();
    const id = ctx.state.planId || "—";

    if (currentName) {
      setPlanLabel(`PLAN ${id} • ${currentName}`);
    } else {
      setPlanLabel(`PLAN ${id}`);
    }
  }

  // Autosave when polygon updates
  window.addEventListener("maizeeye:polygon-updated", () => {
    if (ctx.state.planNameAuto && ctx.state.planNameBase) {
      const area = Number(ctx.state.areaHa) || 0;
      ctx.state.planName = area > 0
        ? `${ctx.state.planNameBase} (${area.toFixed(2)} ha)`
        : ctx.state.planNameBase;

      refreshPlanLabel(ctx);
    }

    saveCurrentPlan(ctx);
  });

  // Autosave when path updates
  window.addEventListener("maizeeye:path-updated", () => {
    saveCurrentPlan(ctx);
  });

  // Level 2 modules
  initGeomanPlanner(ctx);
  initPathPlannerLevel2(ctx);
  initExportMission(ctx);
  initMonitorNav(ctx);

  // Restore saved polygon + flight path AFTER modules are initialized
  try {
    restorePolygonFromState?.(ctx);
  } catch (e) {
    console.warn("restorePolygonFromState failed:", e);
  }

  try {
    restoreFlightFromState?.(ctx);
  } catch (e) {
    console.warn("restoreFlightFromState failed:", e);
  }

  function getPlanNameFromURL() {
    const p = new URLSearchParams(location.search);
    return (p.get("name") || "").trim();
  }

  // Ask to save location only AFTER polygon becomes valid (once per page load)
  let askedLocation = false;
  let locating = false;

  async function handleSaveLocationFlow() {
    if (locating) return;
    locating = true;

    try {
      const loc = await getBrowserLocationOnce();
      ctx.state.homeLatLng = { lat: loc.lat, lng: loc.lng };

      const label = await reverseGeocodeNominatim(loc.lat, loc.lng);
      ctx.state.locationLabel = label;

      // Auto-name the plan based on location
      const updated = autoNamePlanFromLocation(ctx.state.planId, ctx.state.locationLabel);

      // Pull auto-name + numbering fields back into ctx.state so they persist
      if (updated?.name) ctx.state.planName = updated.name;
      ctx.state.planNameAuto = Boolean(updated?.name_auto);
      ctx.state.planNameBase = updated?.name_base || "";

      // barangay-based numbering
      ctx.state.planNameGroupKey = updated?.name_group_key || "";
      ctx.state.planFieldNo = Number(updated?.name_field_no) || 0;

      // Save + refresh header once
      saveCurrentPlan(ctx);
      refreshPlanLabel(ctx);

      console.log("✅ Location saved:", label);
    } catch (err) {
      console.warn("Location not available:", err);
    } finally {
      locating = false;
    }
  }



  window.addEventListener("maizeeye:polygon-updated", (ev) => {
    const pts = ev.detail?.latlngs || [];
    if (!Array.isArray(pts) || pts.length < 3) return;

    // already saved? don't ask
    if (ctx.state.locationLabel) return;
    if (askedLocation || locating) return;

    askedLocation = true;

    showCenterConfirm("Save current location to this plan? (Recommended)", {
      title: "Save Location",
      okText: "OK",
      cancelText: "Cancel",
      onOk: () => {
        handleSaveLocationFlow();
      },
      onCancel: () => {
        // do nothing, just skip
      },
    });
  });
});