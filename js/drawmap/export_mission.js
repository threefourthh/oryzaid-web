// js/drawmap/export_mission.js
import { showCenterNotif } from "./center_notif.js";

function setBtnEnabled(id, on) {
  const b = document.getElementById(id);
  if (b) b.disabled = !on;
}

function makeMissionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `mission_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const MAV_FRAME_GLOBAL = 0;
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;

const MAV_CMD_NAV_WAYPOINT = 16;
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
const MAV_CMD_NAV_LAND = 21;
const MAV_CMD_NAV_TAKEOFF = 22;
const MAV_CMD_DO_CHANGE_SPEED = 178;

function normPoint(wp) {
  const lat = Number(wp.lat);
  const lon = Number(wp.lon ?? wp.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function dedupeConsecutive(points, eps = 1e-7) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last) out.push(p);
    else {
      const sameLat = Math.abs(p.lat - last.lat) < eps;
      const sameLon = Math.abs(p.lon - last.lon) < eps;
      if (!(sameLat && sameLon)) out.push(p);
    }
  }
  return out;
}

function computePolygonCenter(latlngs) {
  if (!Array.isArray(latlngs) || latlngs.length < 3) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const p of latlngs) {
    const lat = Number(p?.lat);
    const lng = Number(p?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLng)
  ) {
    return null;
  }

  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };
}

function buildQGCWaypointsTextPro({
  pathPoints,
  home = null,
  takeoffAlt = 15,
  surveyAlt = 12,
  endAction = "RTL",
  speedMS = null,
  acceptRadiusM = 2,
}) {
  if (!Array.isArray(pathPoints) || pathPoints.length < 2) {
    throw new Error("Path is empty/too short. Generate the flight path first.");
  }

  const first = pathPoints[0];
  const last = pathPoints[pathPoints.length - 1];
  const homePos = home ?? first;

  const lines = ["QGC WPL 110"];
  let seq = 0;

  const push = (current, frame, command, p1, p2, p3, p4, lat, lon, alt, autocontinue = 1) => {
    lines.push([
      seq++,
      current,
      frame,
      command,
      p1, p2, p3, p4,
      Number(lat).toFixed(7),
      Number(lon).toFixed(7),
      Number(alt).toFixed(2),
      autocontinue
    ].join("\t"));
  };

  push(
    1,
    MAV_FRAME_GLOBAL,
    MAV_CMD_NAV_WAYPOINT,
    0, 0, 0, 0,
    homePos.lat, homePos.lon,
    0
  );

  if (Number.isFinite(speedMS) && speedMS > 0) {
    push(
      0,
      MAV_FRAME_GLOBAL_RELATIVE_ALT,
      MAV_CMD_DO_CHANGE_SPEED,
      1, speedMS, -1, 0,
      homePos.lat, homePos.lon,
      0
    );
  }

  push(
    0,
    MAV_FRAME_GLOBAL_RELATIVE_ALT,
    MAV_CMD_NAV_TAKEOFF,
    0, 0, 0, 0,
    homePos.lat, homePos.lon,
    takeoffAlt
  );

  push(
    0,
    MAV_FRAME_GLOBAL_RELATIVE_ALT,
    MAV_CMD_NAV_WAYPOINT,
    0, acceptRadiusM, 0, 0,
    first.lat, first.lon,
    surveyAlt
  );

  for (let i = 1; i < pathPoints.length; i++) {
    const p = pathPoints[i];
    push(
      0,
      MAV_FRAME_GLOBAL_RELATIVE_ALT,
      MAV_CMD_NAV_WAYPOINT,
      0, acceptRadiusM, 0, 0,
      p.lat, p.lon,
      surveyAlt
    );
  }

  if (endAction === "LAND") {
    push(
      0,
      MAV_FRAME_GLOBAL_RELATIVE_ALT,
      MAV_CMD_NAV_LAND,
      0, 0, 0, 0,
      last.lat, last.lon,
      0
    );
  } else {
    push(
      0,
      MAV_FRAME_GLOBAL_RELATIVE_ALT,
      MAV_CMD_NAV_RETURN_TO_LAUNCH,
      0, 0, 0, 0,
      0, 0,
      0
    );
  }

  return lines.join("\n") + "\n";
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function initExportMission(ctx) {
  const exportBtn = document.getElementById("exportBtn");
  if (!exportBtn) return;

  exportBtn.addEventListener("click", () => {
    const wps = ctx.state.flightWaypoints;
    if (!wps || wps.length < 2) {
      showCenterNotif?.("Generate a flight path first.", { okText: "OK" });
      return;
    }

    const missionId = makeMissionId();
    ctx.state.missionId = missionId;

    const rawPoints = (wps || []).map(normPoint).filter(Boolean);
    const pathPoints = dedupeConsecutive(rawPoints);

    // 🔥 NEW: Dynamically grab the exact values from your UI dropdowns right before exporting
    const flightAltInput = document.getElementById("altitudeInput");
    const takeoffAltInput = document.getElementById("takeoffInput");

    const surveyAlt = flightAltInput ? Number(flightAltInput.value) : Number(ctx.state.settings?.altitudeM ?? 12);
    const takeoffAlt = takeoffAltInput ? Number(takeoffAltInput.value) : Number(ctx.state.settings?.takeoffAltM ?? 15);

    // field center from drawn polygon
    const fieldCenter =
      ctx.state.fieldCenter ||
      computePolygonCenter(ctx.state.polygonLatLngs) ||
      ctx.state.homeLatLng ||
      null;

    if (fieldCenter) {
      ctx.state.fieldCenter = {
        lat: Number(fieldCenter.lat),
        lng: Number(fieldCenter.lng),
      };

      // keep compatibility with old code
      ctx.state.homeLatLng = {
        lat: Number(fieldCenter.lat),
        lng: Number(fieldCenter.lng),
      };
    }

    const home = fieldCenter
      ? { lat: Number(fieldCenter.lat), lon: Number(fieldCenter.lng) }
      : null;

    const speedMS = Number(ctx.state.settings?.speedMS ?? 5);

    const text = buildQGCWaypointsTextPro({
      pathPoints,
      home,
      takeoffAlt,
      surveyAlt,
      endAction: "RTL",
      speedMS,
      acceptRadiusM: 2,
    });

    downloadText(text, `${missionId}.waypoints`);

    console.log("Exported mission center:", ctx.state.fieldCenter);

    setBtnEnabled("monitorBtn", true);
    
    // Notification actively displays the exact recorded altitudes
    showCenterNotif?.(
      `Exported!\n\nTakeoff Alt: ${takeoffAlt}m | Flight Alt: ${surveyAlt}m\n\nImport this file into QGroundControl (Plan → Import), then upload mission to Pixhawk.`,
      { okText: "Awesome" }
    );

  });
}