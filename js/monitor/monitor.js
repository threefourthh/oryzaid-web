// js/monitor/monitor.js
import { setApiBaseFromWindowOrDefault } from "../core/api.js";
import { showCenterNotif } from "../drawmap/center_notif.js";

setApiBaseFromWindowOrDefault();

// ---------- Config (Pi-friendly) ----------
const POLL_MS = 5000;
const TIMEOUT_MS = 3500;
const MIN_MOVE_M = 1.5;

// ---------- Tiny helpers ----------
const $ = (id) => document.getElementById(id);

function setTextIfChanged(id, next) {
  const el = $(id);
  if (!el) return;
  const val = next ?? "—";
  if (el.textContent !== String(val)) el.textContent = String(val);
}

function setLed(state) {
  const led = $("statusLed");
  if (!led) return;
  if (state === "ok") led.style.background = "#1ed760";
  else if (state === "warn") led.style.background = "#F6CF3A";
  else if (state === "bad") led.style.background = "#e81123";
  else led.style.background = "#999";
}

function setProgress(percent) {
  const bar = $("progressBar");
  if (!bar) return;
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  bar.style.width = `${p}%`;
}

function nowStr() {
  return new Date().toLocaleTimeString();
}

function formatDateTime(value) {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? new Date(t).toLocaleString() : nowStr();
}

function getPlanIdFromURL() {
  const p = new URLSearchParams(location.search);
  return p.get("plan_id") || "";
}

function getMissionIdFromURL() {
  const p = new URLSearchParams(location.search);
  return p.get("mission_id") || "";
}

function safeNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---------- Local Plan (for full name) ----------
const LOCAL_KEY = "maizeeye_local_plans_v1";

function getLocalPlan(planId) {
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
    return Array.isArray(all) ? all.find((p) => p?.plan_id === planId) : null;
  } catch {
    return null;
  }
}

function formatPlanHeader(planId, plan) {
  const name = String(plan?.name || "").trim();
  return name ? `PLAN ${planId} • ${name}` : (planId ? `PLAN ${planId}` : "PLAN —");
}

// ---------- Haversine meters ----------
function distMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const q =
    s1 * s1 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(q)));
}

// ---------- Networking with timeout ----------
async function apiGetWithTimeout(path, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { getApiBase } = await import("../core/api.js");
    const url = `${getApiBase()}${path}`;

    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(t);
  }
}

// ---------- Normalize mission response ----------
function normalizeMission(raw) {
  const mission = raw?.mission || raw || {};
  const detections = Array.isArray(raw?.detections) ? raw.detections : [];
  const missionId = mission?.mission_id ?? mission?.id ?? "—";
  const t = mission?.telemetry ?? raw?.telemetry ?? raw?.last_telemetry ?? raw?.drone ?? raw ?? {};

  const lat = t?.lat ?? t?.latitude ?? mission?.center_lat ?? raw?.lat;
  const lng = t?.lng ?? t?.lon ?? t?.longitude ?? mission?.center_lng ?? raw?.lng;

  return {
    missionId,
    missionName: mission?.mission_name ?? missionId,
    missionStatus: mission?.mission_status ?? raw?.status ?? t?.status ?? "planned",
    fieldLocation: mission?.field_location ?? "",
    lastMissionTime: mission?.capture_time ?? mission?.updated_at ?? mission?.created_at ?? null,
    detectionsCount: detections.length,

    armed: t?.armed ?? raw?.armed ?? "—",
    mode: t?.mode ?? raw?.mode ?? mission?.mission_status ?? "—",

    lat: Number(lat),
    lng: Number(lng),
    alt: Number(t?.alt ?? t?.altitude ?? mission?.flight_altitude_m ?? raw?.alt),

    voltage: Number(t?.voltage ?? raw?.voltage),
    batteryPct: Number(t?.battery_pct ?? t?.batteryPct ?? raw?.batteryPct),

    link: t?.link ?? t?.rssi ?? raw?.link ?? "—",

    camera: t?.camera ?? raw?.camera ?? "ACTIVE",
    inference: t?.inference ?? raw?.inference ?? (detections.length > 0 ? "RUNNING" : "WAITING"),

    queue: raw?.upload_queue ?? t?.queue ?? "—",
    uploaded: raw?.uploaded ?? t?.uploaded ?? detections.length,
  };
}

// ---------- Geometry helpers ----------
function normalizePoint(p) {
  if (Array.isArray(p) && p.length >= 2) {
    const lat = safeNum(p[0]);
    const lng = safeNum(p[1]);
    return lat != null && lng != null ? [lat, lng] : null;
  }

  const lat = safeNum(p?.lat ?? p?.latitude);
  const lng = safeNum(p?.lng ?? p?.longitude ?? p?.lon);
  return lat != null && lng != null ? [lat, lng] : null;
}

function normalizePoints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizePoint).filter(Boolean);
}

// ---------- Leaflet mini map ----------
let miniMap = null;
let droneMarker = null;
let centerMarker = null;
let boundaryLayer = null;
let flightLayer = null;
let lastLatLng = null;
let missionPathPoints = [];
let mapFittedOnce = false;

function createDroneIcon() {
  return L.divIcon({
    className: "maizeeye-drone-icon",
    html: `
      <div style="
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #22c55e;
        border: 3px solid #ffffff;
        box-shadow: 0 0 0 2px rgba(0,0,0,0.25), 0 0 10px rgba(34,197,94,0.45);
      "></div>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function initMiniMap() {
  const el = $("miniMap");
  if (!el || typeof L === "undefined") return;

  miniMap = L.map("miniMap", {
    zoomControl: true,
    attributionControl: false,
  }).setView([17.6132, 121.7269], 18);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 22,
      attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics",
    }
  ).addTo(miniMap);

  droneMarker = L.marker([17.6132, 121.7269], {
    icon: createDroneIcon(),
  }).addTo(miniMap);

  setTimeout(() => miniMap?.invalidateSize?.(), 250);
}

function clearMissionGeometry() {
  if (!miniMap) return;

  if (boundaryLayer) {
    miniMap.removeLayer(boundaryLayer);
    boundaryLayer = null;
  }

  if (flightLayer) {
    miniMap.removeLayer(flightLayer);
    flightLayer = null;
  }

  if (centerMarker) {
    miniMap.removeLayer(centerMarker);
    centerMarker = null;
  }

  missionPathPoints = [];
  mapFittedOnce = false;
}

function drawMissionGeometry(raw) {
  if (!miniMap) return;

  const mission = raw?.mission || raw || {};

  const boundary = normalizePoints(
    mission?.field_boundary ||
    mission?.polygon ||
    mission?.boundary_points ||
    mission?.drawn_polygon ||
    mission?.field_polygon ||
    []
  );

  const flight = normalizePoints(mission?.flight_path || []);
  missionPathPoints = flight;

  if (boundary.length >= 3) {
    boundaryLayer = L.polygon(boundary, {
      color: "#F6CF3A",
      weight: 4,
      fillColor: "#F6CF3A",
      fillOpacity: 0.14,
    })
      .bindPopup("Field Boundary")
      .addTo(miniMap);
  }

  if (flight.length >= 2) {
    flightLayer = L.polyline(flight, {
      color: "#ffffff",
      weight: 3,
      dashArray: "8,6",
      opacity: 1,
    }).addTo(miniMap);
  }

  const cLat = safeNum(mission?.center_lat);
  const cLng = safeNum(mission?.center_lng);

  if (cLat != null && cLng != null) {
    centerMarker = L.circleMarker([cLat, cLng], {
      radius: 7,
      color: "#22c55e",
      weight: 3,
      fillColor: "#86efac",
      fillOpacity: 0.95,
    })
      .bindPopup(`
        <div>
          <strong>${mission?.mission_name || mission?.mission_id || "Mission Center"}</strong><br>
          Center: ${cLat.toFixed(6)}, ${cLng.toFixed(6)}
        </div>
      `)
      .addTo(miniMap);
  }

  const bounds = [];
  if (boundary.length) bounds.push(...boundary);
  if (flight.length) bounds.push(...flight);
  if (cLat != null && cLng != null) bounds.push([cLat, cLng]);

  if (!mapFittedOnce) {
    if (bounds.length > 1) {
      miniMap.fitBounds(bounds, {
        padding: [24, 24],
        maxZoom: 19,
      });
      mapFittedOnce = true;
    } else if (cLat != null && cLng != null) {
      miniMap.setView([cLat, cLng], 18);
      mapFittedOnce = true;
    }
  }

  if (boundaryLayer?.bringToFront) boundaryLayer.bringToFront();
  if (flightLayer?.bringToFront) flightLayer.bringToFront();
  if (centerMarker?.bringToFront) centerMarker.bringToFront();
  if (droneMarker?.bringToFront) droneMarker.bringToFront();
}

function updateMap(vm) {
  if (!miniMap || !droneMarker) return;
  if (!Number.isFinite(vm.lat) || !Number.isFinite(vm.lng)) return;

  const next = { lat: vm.lat, lng: vm.lng };

  if (lastLatLng && distMeters(lastLatLng, next) < MIN_MOVE_M) return;

  droneMarker.setLatLng([next.lat, next.lng]);

  if (mapFittedOnce) {
    miniMap.panTo([next.lat, next.lng], { animate: false });
  }

  lastLatLng = next;

  if (droneMarker?.bringToFront) droneMarker.bringToFront();

  setTextIfChanged("markerInfo", `Drone @ ${next.lat.toFixed(6)}, ${next.lng.toFixed(6)}`);
}

// ---------- Progress ----------
function findClosestWaypointIndex(current, path) {
  if (!current || !Array.isArray(path) || !path.length) return -1;

  let bestIdx = -1;
  let bestDist = Infinity;

  path.forEach((p, idx) => {
    const d = distMeters(
      { lat: current.lat, lng: current.lng },
      { lat: p[0], lng: p[1] }
    );

    if (d < bestDist) {
      bestDist = d;
      bestIdx = idx;
    }
  });

  return bestIdx;
}

function estimateProgressFromStatus(vm) {
  const st = String(vm.missionStatus || "").toLowerCase();

  if (st.includes("complete") || st.includes("done") || st.includes("finished")) return 100;
  if (st.includes("process")) return 85;
  if (st.includes("scan")) return vm.detectionsCount > 0 ? 60 : 45;
  if (st.includes("plan")) return 10;
  if (st.includes("fail") || st.includes("error")) return 0;
  return 5;
}

function updateProgress(vm) {
  if (
    Array.isArray(missionPathPoints) &&
    missionPathPoints.length >= 2 &&
    Number.isFinite(vm.lat) &&
    Number.isFinite(vm.lng)
  ) {
    const current = { lat: vm.lat, lng: vm.lng };
    const idx = findClosestWaypointIndex(current, missionPathPoints);

    if (idx >= 0) {
      const total = missionPathPoints.length;
      const currentWp = idx + 1;
      const percent = total > 1 ? (idx / (total - 1)) * 100 : 0;

      setTextIfChanged("wpVal", `${currentWp}/${total}`);
      setTextIfChanged("progressPctVal", `${percent.toFixed(0)}%`);
      setProgress(percent);
      return;
    }
  }

  const fallbackPercent = estimateProgressFromStatus(vm);
  setTextIfChanged("wpVal", "—");
  setTextIfChanged("progressPctVal", `${fallbackPercent}%`);
  setProgress(fallbackPercent);
}

// ---------- Render ----------
function render(vm) {
  setTextIfChanged("armedVal", vm.armed);
  setTextIfChanged("modeVal", vm.mode);

  setTextIfChanged("voltVal", Number.isFinite(vm.voltage) ? `${vm.voltage.toFixed(2)} V` : "—");
  setTextIfChanged("batPctVal", Number.isFinite(vm.batteryPct) ? `${vm.batteryPct.toFixed(0)}%` : "—");

  setTextIfChanged("linkVal", vm.link);
  setTextIfChanged("lastUpdateVal", formatDateTime(vm.lastMissionTime));

  setTextIfChanged("latVal", Number.isFinite(vm.lat) ? vm.lat.toFixed(7) : "—");
  setTextIfChanged("lngVal", Number.isFinite(vm.lng) ? vm.lng.toFixed(7) : "—");
  setTextIfChanged("altVal", Number.isFinite(vm.alt) ? `${vm.alt.toFixed(1)} m` : "—");

  setTextIfChanged("camVal", vm.camera);
  setTextIfChanged("inferVal", vm.inference);

  setTextIfChanged("queueVal", vm.queue);
  setTextIfChanged("uploadedVal", String(vm.uploaded ?? "—"));

  updateProgress(vm);
}

function renderStatus(vm) {
  const st = String(vm.missionStatus || "").toUpperCase();

  if (st.includes("FAIL") || st.includes("ERROR")) {
    setLed("bad");
    setTextIfChanged("statusText", vm.missionStatus || "FAILED");
  } else if (st.includes("PLAN")) {
    setLed("warn");
    setTextIfChanged("statusText", vm.missionStatus || "PLANNED");
  } else {
    setLed("ok");
    setTextIfChanged("statusText", vm.missionStatus || "ONLINE");
  }
}

function renderOffline(err) {
  setLed("warn");
  setTextIfChanged("statusText", "OFFLINE / NO DATA");
  setTextIfChanged("sourceLabel", "CLOUD (ERROR)");
  console.warn("Monitor error:", err);
}

// ---------- Nav ----------
function wireNav() {
  $("backPlannerBtn")?.addEventListener("click", () => {
    const planId = getPlanIdFromURL();
    const missionId = getMissionIdFromURL();

    if (planId) {
      location.href = `drawmap.html?plan_id=${encodeURIComponent(planId)}`;
      return;
    }

    if (missionId) {
      location.href = `drawmap.html?mission_id=${encodeURIComponent(missionId)}`;
      return;
    }

    location.href = "drawmap.html";
  });

  $("backBtn")?.addEventListener("click", () => (location.href = "missions.html"));

  $("openResultsBtn")?.addEventListener("click", () => {
    const missionId = resultsMissionId || currentMissionId;
    if (!missionId) return;
    location.href = `results.html?mission_id=${encodeURIComponent(missionId)}`;
  });
}

// ---------- Finished popup ----------
let finishedShown = false;

function maybeShowFinished(vm, resultsMissionId) {
  if (finishedShown) return;

  const st = String(vm.status || "").toUpperCase();

  const isFinished =
    st.includes("FINISHED") ||
    st.includes("COMPLETE") ||
    st.includes("DONE") ||
    st.includes("ENDED");

  if (!isFinished) return;

  finishedShown = true;

  // show popup
  showCenterNotif(
    "Flight finished ✅\nPreparing results and heatmap...",
    { okText: "" }
  );

  // auto redirect to results
  setTimeout(() => {
    location.href = `results.html?mission_id=${encodeURIComponent(resultsMissionId)}`;
  }, 1500);
}
// ---------- Poll loop ----------
let timer = null;
let running = false;
let currentMissionId = null;
let resultsMissionId = null;
let geometryLoaded = false;

async function tick() {
  if (!running || document.hidden) return;

  try {
    setTextIfChanged("sourceLabel", "CLOUD POLL");

    const raw = await apiGetWithTimeout(`/missions/${encodeURIComponent(currentMissionId)}`);

    if (!geometryLoaded) {
      clearMissionGeometry();
      drawMissionGeometry(raw);
      geometryLoaded = true;
    }

    const vm = normalizeMission(raw);

    const title = String(vm.missionName || "").trim() || currentMissionId;
    const loc = String(vm.fieldLocation || "").trim();

    setTextIfChanged(
      "missionTitleLabel",
      loc ? `${title} • ${loc}` : title
    );
    setTextIfChanged("missionIdLabel", vm.missionId || currentMissionId);

    renderStatus(vm);
    render(vm);
    updateMap(vm);

    maybeShowFinished(vm, resultsMissionId);
  } catch (err) {
    renderOffline(err);
  }
}

function startPolling() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, POLL_MS);
  tick();
}

function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

function initVisibilityPause() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    tick();
  });
}

// ---------- Main ----------
function main() {
  const planId = getPlanIdFromURL();
  const missionId = getMissionIdFromURL();

  currentMissionId = missionId || planId || "mission_unknown";
  resultsMissionId = currentMissionId;

  if (planId) {
    const plan = getLocalPlan(planId);
    const header = formatPlanHeader(planId, plan);

    setTextIfChanged("missionTitleLabel", header);
    setTextIfChanged("missionIdLabel", missionId || planId);
  } else {
    setTextIfChanged("missionTitleLabel", currentMissionId);
    setTextIfChanged("missionIdLabel", currentMissionId);
  }

  wireNav();
  initVisibilityPause();
  initMiniMap();

  setLed("idle");
  setTextIfChanged("statusText", "CONNECTING...");
  setTextIfChanged("sourceLabel", "CLOUD POLL");

  $("retryBtn")?.addEventListener("click", () => tick());

  running = true;
  startPolling();

  window.addEventListener("beforeunload", () => {
    running = false;
    stopPolling();
  });
}

main();