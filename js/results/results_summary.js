// js/results/results_summary.js

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = String(value ?? "").trim();
  el.textContent = text || "—";
}

function countBy(items, getter) {
  const out = {};
  for (const item of items) {
    const key = getter(item);
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function normalizeGroup(det) {
  return String(det.class_group || "unknown").trim().toLowerCase();
}

function normalizeSeverity(det) {
  return String(det.severity_level || det.severity || "unknown").trim().toLowerCase();
}

export function initResultsSummary() {
  window.addEventListener("maizeeye:mission-data-loaded", (e) => {
    const mission = e.detail?.mission || {};
    const detections = Array.isArray(e.detail?.detections) ? e.detail.detections : [];

    const byGroup = countBy(detections, normalizeGroup);
    const bySeverity = countBy(detections, normalizeSeverity);

    setText("missionName", mission.mission_name || mission.mission_id || "—");
    setText("missionId", mission.mission_id || "—");
    setText("missionStatusCard", mission.mission_status || "—");
    setText("operatorName", mission.operator_name || "—");
    setText("droneId", mission.drone_id || "—");
    setText("fieldLocation", mission.field_location || "—");
    setText(
      "areaCovered",
      mission.area_covered_ha != null ? `${mission.area_covered_ha} ha` : "—"
    );
    setText(
      "flightAltitude",
      mission.flight_altitude_m != null ? `${mission.flight_altitude_m} m` : "—"
    );
    setText("captureTimeCard", mission.capture_time || "—");
    setText("totalDetections", detections.length);

    setText("diseaseCount", byGroup["disease"] || 0);
    setText("pestCount", byGroup["pest"] || 0);
    setText("waterStressCount", byGroup["water_stress"] || 0);

    setText("lowSeverityCount", bySeverity["low"] || 0);
    setText("mediumSeverityCount", bySeverity["medium"] || 0);
    setText("highSeverityCount", bySeverity["high"] || 0);
  });
}