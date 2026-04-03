// js/results/results_summary.js

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = String(value ?? "").trim();
  el.textContent = text || "—";
}

function normalizeGroup(det) {
  return String(det.class_group || "unknown").trim().toLowerCase();
}

function normalizeSeverity(det) {
  return String(det.severity_level || det.severity || "unknown").trim().toLowerCase();
}

// FORMAT HELPER: Converts raw ISO database time into clean, human-readable format
function formatCaptureTime(isoString) {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString; // Fallback if invalid
  
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

export function initResultsSummary() {
  window.addEventListener("maizeeye:mission-data-loaded", (e) => {
    const mission = e.detail?.mission || {};
    const detections = Array.isArray(e.detail?.detections) ? e.detail.detections : [];

    // 🔥 SCIENTIFIC INCIDENCE MATH
    // Use Set to strictly count UNIQUE IMAGES instead of raw bounding boxes
    const uniqueImagesAll = new Set();
    const uniqueImagesDisease = new Set();
    const uniqueImagesPest = new Set();
    const uniqueImagesWaterStress = new Set();

    const uniqueImagesLow = new Set();
    const uniqueImagesMedium = new Set();
    const uniqueImagesHigh = new Set();

    detections.forEach(det => {
      // Identify unique image by its URL or GPS coordinates
      const imgId = det.image_url || `${det.latitude}_${det.longitude}`;
      uniqueImagesAll.add(imgId);

      const group = normalizeGroup(det);
      if (group === 'disease') uniqueImagesDisease.add(imgId);
      else if (group === 'pest') uniqueImagesPest.add(imgId);
      else if (group === 'water_stress') uniqueImagesWaterStress.add(imgId);

      const sev = normalizeSeverity(det);
      if (sev === 'low') uniqueImagesLow.add(imgId);
      else if (sev === 'medium') uniqueImagesMedium.add(imgId);
      else if (sev === 'high') uniqueImagesHigh.add(imgId);
    });

    // Use the actual, renamed mission ID directly from the database
    let displayId = mission.mission_id || "—";
    let displayName = mission.mission_name || displayId;

    setText("missionName", displayName);
    
    // --- MISSION DETAILS CARD UPDATES ---
    // Targets the exact IDs present in your results.html file
    setText("metaMissionId", displayId);
    setText("metaPlace", mission.field_location || mission.place || "—");
    setText(
      "metaArea",
      mission.area_covered_ha != null ? `${mission.area_covered_ha} ha` : "—"
    );
    setText(
      "metaAltitude",
      mission.flight_altitude_m != null ? `${mission.flight_altitude_m} m` : "—"
    );
    setText("metaDroneId", mission.drone_id || "—");
    
    // Reads the exact capture time from your database and formats it cleanly
    setText("metaCaptureTime", formatCaptureTime(mission.capture_time));
    
    // Additional generic fields (will fail silently if not present in HTML, which is safe)
    setText("missionStatusCard", mission.mission_status || "—");
    setText("operatorName", mission.operator_name || "—");
    
    // Output the UNIQUE IMAGE counts to the UI (if these elements exist)
    setText("totalDetections", uniqueImagesAll.size);
    setText("diseaseCount", uniqueImagesDisease.size);
    setText("pestCount", uniqueImagesPest.size);
    setText("waterStressCount", uniqueImagesWaterStress.size);

    setText("lowSeverityCount", uniqueImagesLow.size);
    setText("mediumSeverityCount", uniqueImagesMedium.size);
    setText("highSeverityCount", uniqueImagesHigh.size);
  });
}