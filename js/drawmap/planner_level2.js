// js/drawmap/planner_level2.js
// Level 2/3: Generate a lawnmower/grid flight path INSIDE the drawn polygon.
// Needs: turf loaded globally (window.turf)

export function initPathPlannerLevel2(ctx) {
  const map = ctx.map;
  const s = ctx.state;

  const btnGen = document.getElementById("generatePathBtn");
  const btnExport = document.getElementById("exportBtn");
  const statusEl = document.querySelector("#plannerStatus .value");

  let pathLine = null;

  // If buttons not found, fail safely (no crash)
  if (!btnGen || !btnExport) {
    console.warn("Planner Level2: Buttons not found (#generatePathBtn or #exportBtn).");
    return;
  }

  // Start disabled until polygon exists
  btnGen.disabled = true;
  btnExport.disabled = true;

  // ----------------------------
  // Small math helpers
  // ----------------------------
  function degToRad(d) {
    return (d * Math.PI) / 180;
  }

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  // ----------------------------
  // Auto spacing based on altitude + HFOV
  // ----------------------------
  function spacingFromCamera({ altitudeM, hFovDeg, sideOverlap = 0.7 }) {
    const alt = Number(altitudeM);
    const fov = Number(hFovDeg);
    const ov = clamp(Number(sideOverlap), 0, 0.95);

    if (!Number.isFinite(alt) || alt <= 0) return 8;
    if (!Number.isFinite(fov) || fov <= 0 || fov >= 179) return 8;

    const footprintW = 2 * alt * Math.tan(degToRad(fov / 2));
    const spacing = footprintW * (1 - ov);

    // reasonable bounds for field planning
    return clamp(spacing, 2, 30);
  }

  // ----------------------------
  // Waypoint limit (Pixhawk-safe)
  // ----------------------------
  function enforceMaxWaypoints(waypoints, maxWps = 800) {
    const arr = Array.isArray(waypoints) ? waypoints : [];
    if (arr.length <= maxWps) return arr;
    if (maxWps < 2) return arr.slice(0, 2);

    const out = [];
    const step = (arr.length - 1) / (maxWps - 1);
    for (let i = 0; i < maxWps; i++) {
      const idx = Math.round(i * step);
      out.push(arr[idx]);
    }
    return out;
  }

  // ----------------------------
  // Mission summary (optional UI)
  // ----------------------------
  function computeMissionSummary({ waypoints, speedMS = 5, mAhPerMin = 250 }) {
    if (!window.turf || !Array.isArray(waypoints) || waypoints.length < 2) {
      return { distanceM: 0, minutes: 0, batteryMah: 0 };
    }

    const coords = waypoints.map((p) => [p.lng, p.lat]); // turf uses [lng,lat]
    const line = turf.lineString(coords);

    const distanceKm = turf.length(line, { units: "kilometers" });
    const distanceM = distanceKm * 1000;

    const v = Math.max(Number(speedMS) || 0, 0.1);
    const seconds = distanceM / v;
    const minutes = seconds / 60;

    const batteryMah = minutes * (Number(mAhPerMin) || 0);

    return { distanceM, minutes, batteryMah };
  }

  function updateSummaryUI(summary) {
    // These elements are optional; if not present, nothing breaks.
    const elD = document.getElementById("sumDistance");
    const elT = document.getElementById("sumTime");
    const elB = document.getElementById("sumBattery");

    if (elD) elD.textContent = `${summary.distanceM.toFixed(0)} m`;
    if (elT) elT.textContent = `${summary.minutes.toFixed(1)} min`;
    if (elB) elB.textContent = `${summary.batteryMah.toFixed(0)} mAh`;
  }

  // ----------------------------
  // Polygon updated event
  // ----------------------------
  window.addEventListener("maizeeye:polygon-updated", (ev) => {
    const { latlngs, layer } = ev.detail || {};
    s.polygonLayer = layer || s.polygonLayer;
    s.polygonLatLngs = Array.isArray(latlngs) ? latlngs : [];

    // Enable Generate only if valid polygon
    btnGen.disabled = s.polygonLatLngs.length < 3;

    // Reset path when polygon changes
    s.flightWaypoints = [];
    btnExport.disabled = true;

    if (pathLine) {
      map.removeLayer(pathLine);
      pathLine = null;
    }

    if (statusEl) {
      statusEl.dataset.state = "planning";
      statusEl.textContent = "PLANNING";
    }

    // reset summary (optional)
    updateSummaryUI({ distanceM: 0, minutes: 0, batteryMah: 0 });
  });

  // ----------------------------
  // Generate path click
  // ----------------------------
  btnGen.addEventListener("click", () => {
    if (!s.polygonLatLngs || s.polygonLatLngs.length < 3) {
      console.warn("No polygon yet.");
      return;
    }

    // Settings (safe defaults)
    const useAutoSpacing = Boolean(s.settings?.autoSpacing ?? true);
    const surveyAlt = Number(s.settings?.altitudeM ?? 12);
    const hFovDeg = Number(s.settings?.hFovDeg ?? 62);
    const overlap = Number(s.settings?.sideOverlap ?? 0.7);

    const spacingM = useAutoSpacing
      ? spacingFromCamera({ altitudeM: surveyAlt, hFovDeg, sideOverlap: overlap })
      : Number(s.settings?.spacingM ?? 8);

    // AUTO angle: allow null to trigger longest-edge orientation
    const angleRaw = s.settings?.angleDeg;
    const angleDeg = Number.isFinite(Number(angleRaw)) ? Number(angleRaw) : null;

    // Home/drone position: use whichever you store
    const homeLatLng = s.homeLatLng ?? s.userLatLng ?? null;

    // Densify + smoothing
    const pointStepM = Number(s.settings?.pointStepM ?? Math.max(3, Math.floor(spacingM / 2)));
    const turnBufferM = Number(s.settings?.turnBufferM ?? 3);

    // Waypoint max
    const maxWaypoints = Number(s.settings?.maxWaypoints ?? 800);

    let waypoints = generateLawnmowerInsidePolygon({
      polygonLatLngs: s.polygonLatLngs,
      spacingM,
      angleDeg,
      homeLatLng,
      pointStepM,
      turnBufferM,
    });

    // Enforce max waypoint limit
    waypoints = enforceMaxWaypoints(waypoints, maxWaypoints);

    // Save
    s.flightWaypoints = waypoints;
    window.dispatchEvent(new CustomEvent("maizeeye:path-updated", { detail: { waypoints } }));

    // Draw preview
    if (pathLine) map.removeLayer(pathLine);
    pathLine = L.polyline(waypoints, { weight: 3, opacity: 0.9 }).addTo(map);

    // Enable export
    btnExport.disabled = waypoints.length < 2;

    // Status
    if (statusEl) {
      statusEl.dataset.state = "ready";
      statusEl.textContent = "READY";
    }

    // Summary
    const speedMS = Number(s.settings?.speedMS ?? 5);
    const mAhPerMin = Number(s.settings?.mAhPerMin ?? 250);
    const summary = computeMissionSummary({ waypoints, speedMS, mAhPerMin });
    updateSummaryUI(summary);

    // Zoom
    if (waypoints.length >= 2) {
      const b = pathLine.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.15));
    }
  });
}

/* =========================
   Core path generator
========================= */

function generateLawnmowerInsidePolygon({
  polygonLatLngs,
  spacingM = 8,
  angleDeg = null,      // null => auto
  homeLatLng = null,    // {lat,lng} or null
  pointStepM = 4,
  turnBufferM = 3,
}) {
  if (!window.turf) {
    console.error("Turf not loaded. Check script order in HTML.");
    return [];
  }

  const toKm = (m) => m / 1000;

  // ----------------------------
  // Helpers
  // ----------------------------
  const normAngle = (a) => {
    let x = Number(a) % 360;
    if (x >= 180) x -= 360;
    if (x < -180) x += 360;
    return x;
  };

  function pushDedup(list, coord, eps = 1e-10) {
    if (!coord) return;
    const last = list[list.length - 1];
    if (!last) return list.push(coord);
    const same =
      Math.abs(coord[0] - last[0]) < eps &&
      Math.abs(coord[1] - last[1]) < eps;
    if (!same) list.push(coord);
  }

  function densifyLineCoords(a, b, stepM) {
    const line = turf.lineString([a, b]);
    const lenKm = turf.length(line, { units: "kilometers" });
    if (lenKm <= 0) return [a, b];

    const stepKm = Math.max(toKm(Math.max(1, stepM)), 0.001);
    const coords = [a];

    for (let d = stepKm; d < lenKm; d += stepKm) {
      coords.push(turf.along(line, d, { units: "kilometers" }).geometry.coordinates);
    }

    coords.push(b);
    return coords;
  }

  function buildTurnConnector(endB, nextA, bufferM) {
    const bx = endB[0], by = endB[1];
    const ax = nextA[0], ay = nextA[1];

    if (Math.abs(bx - ax) < 1e-12 && Math.abs(by - ay) < 1e-12) return [];
    if (Math.abs(bx - ax) < 1e-12 || Math.abs(by - ay) < 1e-12) return [nextA];

    const corner = [ax, by];
    if (!(bufferM > 0)) return [corner, nextA];

    const lineToCorner = turf.lineString([endB, corner]);
    const lenKm = turf.length(lineToCorner, { units: "kilometers" });
    const bufKm = Math.min(toKm(bufferM), lenKm * 0.45);
    const nearCorner = turf.along(lineToCorner, bufKm, { units: "kilometers" }).geometry.coordinates;

    return [nearCorner, corner, nextA];
  }

  function computeAutoAngleFromLongestEdge(ringLngLat) {
    let best = { lenKm: -1, bearing: 0 };
    for (let i = 0; i < ringLngLat.length - 1; i++) {
      const a = ringLngLat[i];
      const b = ringLngLat[i + 1];
      const d = turf.distance(turf.point(a), turf.point(b), { units: "kilometers" });
      if (d > best.lenKm) {
        const brg = turf.bearing(turf.point(a), turf.point(b));
        best = { lenKm: d, bearing: brg };
      }
    }
    return normAngle(-best.bearing);
  }

  function rotatedPointCoord(lng, lat, deg, pivot) {
    const pt = turf.point([lng, lat]);
    const rotated = turf.transformRotate(pt, deg, { pivot });
    return rotated.geometry.coordinates;
  }

  function buildRouteCoords(segments, startFromLeft, startParity, pointStepM, turnBufferM) {
    const segs = startFromLeft ? segments : [...segments].reverse();
    const route = [];

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const coords = seg.geometry.coordinates;
      if (!coords || coords.length < 2) continue;

      let a = coords[0];
      let b = coords[coords.length - 1];

      const idxParity = (i + startParity) % 2;
      if (idxParity === 1) [a, b] = [b, a];

      densifyLineCoords(a, b, pointStepM).forEach((c) => pushDedup(route, c));

      if (i < segs.length - 1) {
        const nextSeg = segs[i + 1];
        const nc = nextSeg.geometry.coordinates;
        if (nc && nc.length >= 2) {
          let nextA = nc[0];
          let nextB = nc[nc.length - 1];

          const nextParity = ((i + 1) + startParity) % 2;
          if (nextParity === 1) [nextA, nextB] = [nextB, nextA];

          buildTurnConnector(b, nextA, turnBufferM).forEach((c) => pushDedup(route, c));
        }
      }
    }

    return route;
  }

  function pickBestRouteByHome(routes, homeCoord) {
    if (!homeCoord) return routes[0];

    let best = routes[0];
    let bestD = Infinity;

    for (const r of routes) {
      if (!r || r.length < 2) continue;
      const d = turf.distance(turf.point(homeCoord), turf.point(r[0]), { units: "kilometers" });
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }

    const startD = turf.distance(turf.point(homeCoord), turf.point(best[0]), { units: "kilometers" });
    const endD = turf.distance(turf.point(homeCoord), turf.point(best[best.length - 1]), { units: "kilometers" });

    if (endD + 1e-6 < startD) return [...best].reverse();
    return best;
  }

  // ----------------------------
  // Polygon ring
  // ----------------------------
  const ring = polygonLatLngs.map((p) => [p.lng, p.lat]);
  ring.push(ring[0]);

  let poly = turf.polygon([ring]);
  const pivot = turf.centerOfMass(poly);

  // Auto angle if null/invalid
  let usedAngleDeg = angleDeg;
  if (!Number.isFinite(Number(usedAngleDeg))) {
    usedAngleDeg = computeAutoAngleFromLongestEdge(ring);
  }
  usedAngleDeg = normAngle(usedAngleDeg);

  if (usedAngleDeg) {
    poly = turf.transformRotate(poly, usedAngleDeg, { pivot });
  }

  // Rotate home into same rotated space for best start
  let homeCoordRot = null;
  if (
    homeLatLng &&
    Number.isFinite(Number(homeLatLng.lat)) &&
    Number.isFinite(Number(homeLatLng.lng))
  ) {
    homeCoordRot = rotatedPointCoord(
      Number(homeLatLng.lng),
      Number(homeLatLng.lat),
      usedAngleDeg,
      pivot
    );
  }

  // ----------------------------
  // Sweep segmentation
  // ----------------------------
  const bbox = turf.bbox(poly);
  const spacingKm = toKm(spacingM);
  const boundary = turf.polygonToLine(poly);

  const segments = [];
  let x = bbox[0];
  const midY = (bbox[1] + bbox[3]) / 2;

  while (x <= bbox[2]) {
    const scan = turf.lineString([[x, bbox[1]], [x, bbox[3]]]);
    const split = turf.lineSplit(scan, boundary);

    split.features.forEach((seg) => {
      const len = turf.length(seg, { units: "kilometers" });
      if (len <= 0) return;

      const mid = turf.along(seg, len / 2, { units: "kilometers" });
      if (turf.booleanPointInPolygon(mid, poly)) segments.push(seg);
    });

    const p = turf.point([x, midY]);
    const moved = turf.destination(p, spacingKm, 90, { units: "kilometers" });
    x = moved.geometry.coordinates[0];
  }

  if (!segments.length) return [];

  segments.sort((a, b) => turf.bbox(a)[0] - turf.bbox(b)[0]);

  // 4 candidates (start side + parity), choose closest-to-home
  const candidates = [
    buildRouteCoords(segments, true, 0, pointStepM, turnBufferM),
    buildRouteCoords(segments, true, 1, pointStepM, turnBufferM),
    buildRouteCoords(segments, false, 0, pointStepM, turnBufferM),
    buildRouteCoords(segments, false, 1, pointStepM, turnBufferM),
  ].filter((r) => r && r.length >= 2);

  if (!candidates.length) return [];

  const bestRouteRot = pickBestRouteByHome(candidates, homeCoordRot);

  // Rotate back
  let fc = turf.featureCollection(bestRouteRot.map((c) => turf.point(c)));
  if (usedAngleDeg) {
    fc = turf.transformRotate(fc, -usedAngleDeg, { pivot });
  }

  return fc.features.map((f) => {
    const [lng, lat] = f.geometry.coordinates;
    return { lat, lng };
  });
}

// ✅ Restore saved flight path when opening an existing plan
export function restoreFlightFromState(ctx) {
  const map = ctx.map;
  const s = ctx.state;

  if (!map) return;
  if (!Array.isArray(s.flightWaypoints) || s.flightWaypoints.length < 2) return;

  if (typeof L === "undefined") return;

  // remove old layer if exists
  if (s.flightLayer) {
    try { map.removeLayer(s.flightLayer); } catch {}
    s.flightLayer = null;
  }

  // draw saved path
  const line = L.polyline(s.flightWaypoints, {
    weight: 3,
    opacity: 0.9
  }).addTo(map);

  s.flightLayer = line;

  // notify the system so autosave + UI work correctly
  window.dispatchEvent(
    new CustomEvent("maizeeye:path-updated", {
      detail: { waypoints: s.flightWaypoints }
    })
  );

  // zoom to the path
  try {
    const b = line.getBounds();
    if (b.isValid()) map.fitBounds(b.pad(0.15));
  } catch {}
}