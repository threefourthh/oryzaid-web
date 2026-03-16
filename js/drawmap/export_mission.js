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

// QGC / MAVLink constants
const MAV_FRAME_GLOBAL = 0;
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;

const MAV_CMD_NAV_WAYPOINT = 16;
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
const MAV_CMD_NAV_LAND = 21;
const MAV_CMD_NAV_TAKEOFF = 22;
const MAV_CMD_DO_CHANGE_SPEED = 178; // optional (works on many firmwares)

/**
 * Make a clean {lat, lon} from waypoint object.
 * Accepts lon|lng (because some of your code uses lng).
 */
function normPoint(wp) {
  const lat = Number(wp.lat);
  const lon = Number(wp.lon ?? wp.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/** Remove consecutive duplicates (helps avoid "micro jitter" missions) */
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

/**
 * Build QGC WPL 110 mission:
 * 0) HOME row (like QGC exports)
 * 1) TAKEOFF
 * 2) GOTO first grid point
 * 3) All grid points
 * 4) RTL or LAND
 */
function buildQGCWaypointsTextPro({
  pathPoints,          // [{lat,lon}, ...] sweep order
  home = null,         // {lat,lon} or null
  takeoffAlt = 15,     // meters
  surveyAlt = 12,      // meters
  endAction = "RTL",   // "RTL" or "LAND"
  speedMS = null,      // number or null
  acceptRadiusM = 2,   // param2 for waypoint (meters)
}) {
  if (!Array.isArray(pathPoints) || pathPoints.length < 2) {
    throw new Error("Path is empty/too short. Generate the flight path first.");
  }

  const first = pathPoints[0];
  const last = pathPoints[pathPoints.length - 1];

  // If no home given, use first path point as home reference (safe default)
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

  // 0) HOME row (QGC-style)
  // QGC typically writes HOME as cmd=16, frame=0, alt=0, current=1
  push(
    1,
    MAV_FRAME_GLOBAL,
    MAV_CMD_NAV_WAYPOINT,
    0, 0, 0, 0,
    homePos.lat, homePos.lon,
    0
  );

  // Optional: set speed (helps consistent survey). Many firmwares support.
  // p1: speed type (0=airspeed, 1=groundspeed), p2: speed (m/s), p3: throttle (-1 no change)
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

  // 1) TAKEOFF (relative altitude)
  push(
    0,
    MAV_FRAME_GLOBAL_RELATIVE_ALT,
    MAV_CMD_NAV_TAKEOFF,
    0, 0, 0, 0,
    homePos.lat, homePos.lon,
    takeoffAlt
  );

  // 2) GOTO FIRST GRID POINT
  // NAV_WAYPOINT params:
  // p1: hold time (s), p2: acceptance radius (m), p3: pass radius (m), p4: yaw (deg, NaN/0 ok)
  push(
    0,
    MAV_FRAME_GLOBAL_RELATIVE_ALT,
    MAV_CMD_NAV_WAYPOINT,
    0, acceptRadiusM, 0, 0,
    first.lat, first.lon,
    surveyAlt
  );

  // 3) GRID WAYPOINTS
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

  // 4) END ACTION
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

    // Normalize + clean your path points
    const rawPoints = (wps || []).map(normPoint).filter(Boolean);
    const pathPoints = dedupeConsecutive(rawPoints);

    const takeoffAlt = Number(ctx.state.settings?.takeoffAltM ?? 15);
    const surveyAlt = Number(ctx.state.settings?.altitudeM ?? 12);

    // Optional (if you store home somewhere; if not, it auto-uses first point)
    const home = ctx.state.homeLatLng
      ? { lat: Number(ctx.state.homeLatLng.lat), lon: Number(ctx.state.homeLatLng.lng) }
      : null;

    // Optional speed (m/s). Example: 5 = ~18 kph
    const speedMS = Number(ctx.state.settings?.speedMS ?? 5);

    const text = buildQGCWaypointsTextPro({
      pathPoints,
      home,
      takeoffAlt,
      surveyAlt,
      endAction: "RTL",      // or "LAND"
      speedMS,               // set to null if you don't want speed command
      acceptRadiusM: 2       // tighter = more accurate, but too tight can cause “overshoot” loops
    });
    downloadText(text, `${missionId}.waypoints`);

    setBtnEnabled("monitorBtn", true);
    showCenterNotif?.(
      "Exported! Import this file into QGroundControl (Plan → Import), then upload mission to Pixhawk.",
      { okText: "OK" }
    );
  });
}