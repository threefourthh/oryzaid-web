// js/results/results_map.js
import { apiGet } from "../core/api.js";

export function initResultsMap({ mapId = "map" } = {}) {
  const SAFE_MAX_ZOOM = 18;

  const map = L.map(mapId, {
    maxZoom: SAFE_MAX_ZOOM,
    preferCanvas: true,
  });
  window.map = map;

  map.setView([17.6534, 121.7334], 18);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: SAFE_MAX_ZOOM,
      maxNativeZoom: SAFE_MAX_ZOOM,
      crossOrigin: true,
      attribution: "Tiles &copy; Esri &mdash; Source: Esri",
    }
  ).addTo(map);

  let diseaseHeatLayer = null;
  let pestHeatLayer = null;
  let fieldBoundaryLayer = null;

  const detectionMarkersLayer = L.layerGroup().addTo(map);
  const diseaseMarkersLayer = L.layerGroup().addTo(map);
  const pestMarkersLayer = L.layerGroup().addTo(map);

  let diseaseVisible = true;
  let pestVisible = true;

  const percentEls = {
    Bacterial_Leaf_Blight: document.getElementById("Commonrust"),
    Fungal_Spot: document.getElementById("NCLB"),
    Leaf_Scald: document.getElementById("GrayLeafSpot"),
    Tungro: document.getElementById("FAW"),
    Rice_Hispa: document.getElementById("grasshopper"),
  };

  const diseaseBtns = [
    document.getElementById("CRsee"),
    document.getElementById("lbsee"),
    document.getElementById("glssee"),
    document.getElementById("FAWsee"),
  ];

  const pestBtns = [document.getElementById("VGsee")];

  function safeNum(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeMissionPayload(payload) {
    const mission = payload?.mission || payload?.data?.mission || payload?.data || payload || {};
    const detections = payload?.detections || payload?.mission?.detections || payload?.data?.detections || payload?.results || (Array.isArray(payload?.data) ? payload.data : []) || [];
    return { mission, detections };
  }

  function normalizeLabel(raw) {
    const label = String(raw || "").trim().toLowerCase();
    if (label.includes("bacterial") || label.includes("blight")) return "Bacterial_Leaf_Blight";
    if (label.includes("fungal") || label.includes("spot")) return "Fungal_Spot";
    if (label.includes("scald")) return "Leaf_Scald";
    if (label.includes("tungro")) return "Tungro";
    if (label.includes("hispa")) return "Rice_Hispa";
    return "Unknown";
  }

  function getDetectionLatLng(det, mission) {
    let lat = parseFloat(det.latitude ?? det.lat ?? det.gps_lat ?? det.center_lat);
    let lng = parseFloat(det.longitude ?? det.lng ?? det.lon ?? det.gps_lng ?? det.center_lng);

    // 🔥 FIXED: Always use the exact center of the yellow boundary box if DB coords are missing
    if (isNaN(lat) || isNaN(lng)) {
      let baseLat = 17.6534;
      let baseLng = 121.7334;

      if (window.fieldBoundaryLayer) {
        const bounds = window.fieldBoundaryLayer.getBounds();
        baseLat = bounds.getCenter().lat;
        baseLng = bounds.getCenter().lng;
      } else if (mission) {
        baseLat = safeNum(mission.center_lat, 17.6534);
        baseLng = safeNum(mission.center_lng, 121.7334);
      }

      // Small scatter effect so the heatmaps don't stack directly on a single pixel
      lat = baseLat + (Math.random() * 0.0006 - 0.0003);
      lng = baseLng + (Math.random() * 0.0006 - 0.0003);
    }
    
    return [lat, lng];
  }

  function getIntensity(det) {
    const area = safeNum(det.affected_area_percent);
    if (area != null) return Math.max(0.6, Math.min(1.0, 0.6 + (area / 100) * 0.4));
    return 0.8;
  }

  function isDisease(label) {
    return ["Bacterial_Leaf_Blight", "Fungal_Spot", "Leaf_Scald", "Tungro"].includes(label);
  }

  function isPest(label) {
    return ["Rice_Hispa"].includes(label);
  }

  function updatePercentages(detections) {
    const totals = { Bacterial_Leaf_Blight: 0, Fungal_Spot: 0, Leaf_Scald: 0, Tungro: 0, Rice_Hispa: 0 };
    const counts = { Bacterial_Leaf_Blight: 0, Fungal_Spot: 0, Leaf_Scald: 0, Tungro: 0, Rice_Hispa: 0 };

    detections.forEach((det) => {
      const key = normalizeLabel(det.issue_type || det.label || det.class_name);
      if (!(key in totals)) return;
      const area = safeNum(det.affected_area_percent);
      if (area != null) { totals[key] += area; counts[key] += 1; } 
      else { totals[key] += 1; counts[key] += 1; }
    });

    Object.keys(percentEls).forEach((key) => {
      const el = percentEls[key];
      if (!el) return;
      let value = counts[key] > 0 ? (totals[key] > counts[key] ? totals[key] / counts[key] : totals[key]) : 0;
      el.textContent = `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;
    });
  }

  function clearLayers() {
    if (diseaseHeatLayer) { map.removeLayer(diseaseHeatLayer); diseaseHeatLayer = null; }
    if (pestHeatLayer) { map.removeLayer(pestHeatLayer); pestHeatLayer = null; }
    if (fieldBoundaryLayer) { map.removeLayer(fieldBoundaryLayer); fieldBoundaryLayer = null; }
    diseaseMarkersLayer.clearLayers();
    pestMarkersLayer.clearLayers();
    detectionMarkersLayer.clearLayers();
    window.fieldBoundaryLayer = null;
  }

  function applyVisibility() {
    if (diseaseHeatLayer) {
      if (diseaseVisible && !map.hasLayer(diseaseHeatLayer)) diseaseHeatLayer.addTo(map);
      if (!diseaseVisible && map.hasLayer(diseaseHeatLayer)) map.removeLayer(diseaseHeatLayer);
    }
    if (pestHeatLayer) {
      if (pestVisible && !map.hasLayer(pestHeatLayer)) pestHeatLayer.addTo(map);
      if (!pestVisible && map.hasLayer(pestHeatLayer)) map.removeLayer(pestHeatLayer);
    }
  }

  function setButtonsState(buttons, visible) {
    buttons.forEach((btn) => {
      if (!btn) return;
      btn.dataset.active = visible ? "1" : "0";
      btn.style.opacity = visible ? "1" : "0.55";
    });
  }

  function syncLayerStatusBar() {
    const dEl = document.getElementById("chipDisease");
    if (dEl) { dEl.textContent = `Diseases: ${diseaseVisible ? "ON" : "OFF"}`; dEl.className = diseaseVisible ? "on" : "off"; }
    const pEl = document.getElementById("chipPest");
    if (pEl) { pEl.textContent = `Pests: ${pestVisible ? "ON" : "OFF"}`; pEl.className = pestVisible ? "on" : "off"; }
  }

  function syncAllButtonStates() {
    setButtonsState(diseaseBtns, diseaseVisible);
    setButtonsState(pestBtns, pestVisible);
    syncLayerStatusBar();
  }

  function renderFieldBoundary(mission) {
    const raw = mission?.field_boundary || mission?.polygon || mission?.boundary_points || mission?.drawn_polygon || mission?.field_polygon || [];
    if (!Array.isArray(raw) || !raw.length) return [];

    const latlngs = raw.map((p) => {
      if (Array.isArray(p) && p.length >= 2) return [safeNum(p[0]), safeNum(p[1])];
      return [safeNum(p?.lat ?? p?.latitude), safeNum(p?.lng ?? p?.longitude)];
    }).filter(p => p[0] != null && p[1] != null);

    if (latlngs.length < 3) return [];

    fieldBoundaryLayer = L.polygon(latlngs, {
      color: "#F6CF3A", weight: 4, fillColor: "#F6CF3A", fillOpacity: 0.15,
    }).addTo(map);

    window.fieldBoundaryLayer = fieldBoundaryLayer;
    return latlngs;
  }

  function renderHeatmaps(detections, mission) {
    if (!Array.isArray(detections) || detections.length === 0) {
      updatePercentages([]);
      return;
    }

    const diseasePoints = [];
    const pestPoints = [];

    detections.forEach((det) => {
      const label = normalizeLabel(det.issue_type || det.label || det.class_name);
      const latlng = getDetectionLatLng(det, mission);
      const intensity = getIntensity(det);
      
      if (isDisease(label)) diseasePoints.push([latlng[0], latlng[1], intensity]);
      else if (isPest(label)) pestPoints.push([latlng[0], latlng[1], intensity]);
    });

    console.log("✅ Final Points Placed in Boundary:", diseasePoints);

    updatePercentages(detections);

    if (diseasePoints.length > 0) {
      diseaseHeatLayer = L.heatLayer(diseasePoints, {
        radius: 40,
        blur: 25,
        maxZoom: SAFE_MAX_ZOOM,
        minOpacity: 0.6,
        gradient: { 0.4: "yellow", 0.7: "orange", 1.0: "red" }
      });
    }

    if (pestPoints.length > 0) {
      pestHeatLayer = L.heatLayer(pestPoints, {
        radius: 40,
        blur: 25,
        maxZoom: SAFE_MAX_ZOOM,
        minOpacity: 0.6,
        gradient: { 0.4: "yellow", 0.7: "orange", 1.0: "#cc6600" }
      });
    }

    applyVisibility();
    syncAllButtonStates();
  }

  async function loadMission(missionId) {
    if (!missionId) return;

    try {
      const payload = await apiGet(`/missions/${encodeURIComponent(missionId)}`);
      const { mission, detections } = normalizeMissionPayload(payload);

      clearLayers();

      // 1. Draw boundary
      renderFieldBoundary(mission);

      // 2. Instantly snap to the field without animating (Fixes the race condition)
      if (window.fieldBoundaryLayer) {
        map.fitBounds(window.fieldBoundaryLayer.getBounds(), { padding: [10, 10], animate: false });
      }

      // 3. Drop the heatmaps directly inside the boundary
      renderHeatmaps(detections, mission);

      window.dispatchEvent(new CustomEvent("maizeeye:mission-data-loaded", { detail: { mission, detections } }));
    } catch (err) {
      console.error("Failed to load mission:", err);
      clearLayers();
    }
  }

  diseaseBtns.forEach((btn) => {
    btn?.addEventListener("click", () => { diseaseVisible = !diseaseVisible; applyVisibility(); syncAllButtonStates(); });
  });

  pestBtns.forEach((btn) => {
    btn?.addEventListener("click", () => { pestVisible = !pestVisible; applyVisibility(); syncAllButtonStates(); });
  });

  window.addEventListener("maizeeye:mission-selected", (e) => {
    const missionId = e.detail?.missionId || e.detail?.mission_id || e.detail?.id || e.detail;
    loadMission(missionId);
  });
}