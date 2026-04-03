// js/results/results_map.js
import { apiGet } from "../core/api.js";

export function initResultsMap({ mapId = "map" } = {}) {
  const ACTUAL_MAX_ZOOM = 22; 
  const MAX_NATIVE_ZOOM = 19; 

  const map = L.map(mapId, {
    maxZoom: ACTUAL_MAX_ZOOM,
    preferCanvas: true,
  });
  window.map = map;

  map.setView([17.6534, 121.7334], 18);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: ACTUAL_MAX_ZOOM,
      maxNativeZoom: MAX_NATIVE_ZOOM, 
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

  let currentView = 'disease'; // 'disease' or 'pest'
  let avgDiseaseSeverity = 0;
  let avgPestSeverity = 0;

  const percentEls = {
    Bacterial_Leaf_Blight: { id: "Commonrust", row: "row_Bacterial_Leaf_Blight" },
    Fungal_Spot: { id: "NCLB", row: "row_Fungal_Spot" },
    Leaf_Scald: { id: "GrayLeafSpot", row: "row_Leaf_Scald" },
    Tungro: { id: "FAW", row: "row_Tungro" },
    Rice_Hispa: { id: "grasshopper", row: "row_Rice_Hispa" },
  };

  const headerDisease = document.getElementById("diseaseHeader");
  const headerPest = document.getElementById("pestHeader");
  const chipDisease = document.getElementById("chipDisease");
  const chipPest = document.getElementById("chipPest");
  const cardDisease = document.getElementById("disresult");
  const cardPest = document.getElementById("pestresult");

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

      lat = baseLat + (Math.random() * 0.0006 - 0.0003);
      lng = baseLng + (Math.random() * 0.0006 - 0.0003);
    }
    
    return [lat, lng];
  }

  function getIntensity(det) {
    const area = safeNum(det.affected_area_percent);
    if (area != null) return Math.max(0.6, Math.min(1.0, 0.6 + (area / 100) * 0.4));
    
    const conf = safeNum(det.confidence);
    if (conf != null) {
        const normConf = conf > 1 ? conf / 100 : conf;
        return Math.max(0.6, Math.min(1.0, 0.6 + (normConf * 0.4)));
    }
    return 0.8;
  }

  function isDisease(label) {
    return ["Bacterial_Leaf_Blight", "Fungal_Spot", "Leaf_Scald", "Tungro"].includes(label);
  }

  function isPest(label) {
    return ["Rice_Hispa"].includes(label);
  }

  function updateSeverityUI() {
    const arrow = document.getElementById("severityArrow");
    const textObj = document.getElementById("severityValueText");
    const titleObj = document.getElementById("severityTitle");

    let val = currentView === 'disease' ? avgDiseaseSeverity : avgPestSeverity;
    val = Math.max(0, Math.min(100, val));

    if (arrow) arrow.style.left = `${val}%`;

    if (!textObj || !titleObj) return;

    titleObj.textContent = currentView === 'disease' ? "DISEASE SEVERITY" : "PEST SEVERITY";

    if (val === 0) {
      textObj.textContent = "Average: 0% (No Detection)";
      textObj.style.color = "var(--muted)";
    } else if (val <= 30) {
      textObj.textContent = `Average: ${val.toFixed(1)}% (Low / Slight)`;
      textObj.style.color = "#d97706"; 
    } else if (val <= 50) {
      textObj.textContent = `Average: ${val.toFixed(1)}% (Moderate)`;
      textObj.style.color = "#ea580c"; 
    } else {
      textObj.textContent = `Average: ${val.toFixed(1)}% (Severe)`;
      textObj.style.color = "#dc2626"; 
    }
  }

  function updatePercentages(detections, mission) {
    const totalImages = safeNum(mission?.total_images) || Math.max(detections.length, 1);

    // 🔥 SCIENTIFICALLY DEFENSIBLE METHOD (Quadrat Sampling logic)
    // We use a 'Set' to count unique image URLs. 
    // If one image has 10 detections, it only counts as 1 infected "Quadrat" of the field.
    const diseaseImages = new Set();
    const pestImages = new Set();
    
    const classImages = {
      Bacterial_Leaf_Blight: new Set(),
      Fungal_Spot: new Set(),
      Leaf_Scald: new Set(),
      Tungro: new Set(),
      Rice_Hispa: new Set()
    };

    detections.forEach((det) => {
      const key = normalizeLabel(det.issue_type || det.label || det.class_name);
      // Use the image URL as the unique identifier. If missing, fallback to gps coordinates.
      const uniqueImageId = det.image_url || `${det.latitude}_${det.longitude}`;

      if (key in classImages) {
        classImages[key].add(uniqueImageId);
      }

      if (isDisease(key)) {
        diseaseImages.add(uniqueImageId);
      } else if (isPest(key)) {
        pestImages.add(uniqueImageId);
      }
    });

    // Calculate Spatial Incidence: (Unique Infected Images / Total Images) * 100
    avgDiseaseSeverity = (diseaseImages.size / totalImages) * 100;
    avgPestSeverity = (pestImages.size / totalImages) * 100;

    Object.keys(percentEls).forEach((key) => {
      const elInfo = percentEls[key];
      const spanEl = document.getElementById(elInfo.id);
      const rowEl = document.getElementById(elInfo.row);
      
      // Calculate incidence for this specific class
      let value = (classImages[key].size / totalImages) * 100;
      
      // Update UI with 1 decimal place precision! This replaces the rounded 6%
      if (spanEl) spanEl.textContent = `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;

      if (rowEl) {
        if (value === 0) rowEl.classList.add("hidden-row");
        else rowEl.classList.remove("hidden-row");
      }
    });
    
    updateSeverityUI();
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
      if (currentView === 'disease' && !map.hasLayer(diseaseHeatLayer)) diseaseHeatLayer.addTo(map);
      if (currentView !== 'disease' && map.hasLayer(diseaseHeatLayer)) map.removeLayer(diseaseHeatLayer);
    }
    if (pestHeatLayer) {
      if (currentView === 'pest' && !map.hasLayer(pestHeatLayer)) pestHeatLayer.addTo(map);
      if (currentView !== 'pest' && map.hasLayer(pestHeatLayer)) map.removeLayer(pestHeatLayer);
    }

    if (chipDisease) {
      chipDisease.textContent = currentView === 'disease' ? "Diseases: ON" : "Diseases: OFF";
      chipDisease.className = currentView === 'disease' ? "layer-chip disease on" : "layer-chip disease off";
    }
    if (chipPest) {
      chipPest.textContent = currentView === 'pest' ? "Pests: ON" : "Pests: OFF";
      chipPest.className = currentView === 'pest' ? "layer-chip pest on" : "layer-chip pest off";
    }

    if (cardDisease && cardPest) {
      if (currentView === 'disease') {
        cardDisease.classList.replace("inactive-card", "active-card");
        cardPest.classList.replace("active-card", "inactive-card");
      } else {
        cardPest.classList.replace("inactive-card", "active-card");
        cardDisease.classList.replace("active-card", "inactive-card");
      }
    }

    updateSeverityUI();
  }

  function setupToggles() {
    const switchView = (view) => {
      currentView = view;
      applyVisibility();
    };

    if (headerDisease) headerDisease.addEventListener("click", () => switchView('disease'));
    if (chipDisease) chipDisease.addEventListener("click", () => switchView('disease'));
    
    if (headerPest) headerPest.addEventListener("click", () => switchView('pest'));
    if (chipPest) chipPest.addEventListener("click", () => switchView('pest'));
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
      updatePercentages([], mission);
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

    updatePercentages(detections, mission);

    if (diseasePoints.length > 0) {
      diseaseHeatLayer = L.heatLayer(diseasePoints, {
        radius: 40,
        blur: 25,
        maxZoom: ACTUAL_MAX_ZOOM, 
        minOpacity: 0.6,
        gradient: { 0.4: "yellow", 0.7: "orange", 1.0: "red" }
      });
    }

    if (pestPoints.length > 0) {
      pestHeatLayer = L.heatLayer(pestPoints, {
        radius: 40,
        blur: 25,
        maxZoom: ACTUAL_MAX_ZOOM, 
        minOpacity: 0.6,
        gradient: { 0.4: "yellow", 0.7: "orange", 1.0: "#cc6600" }
      });
    }

    applyVisibility();
  }

  async function loadMission(missionId) {
    if (!missionId) return;

    try {
      const payload = await apiGet(`/missions/${encodeURIComponent(missionId)}`);
      const { mission, detections } = normalizeMissionPayload(payload);

      clearLayers();
      renderFieldBoundary(mission);

      if (window.fieldBoundaryLayer) {
        map.fitBounds(window.fieldBoundaryLayer.getBounds(), { padding: [10, 10], animate: false });
      }

      renderHeatmaps(detections, mission);

      window.dispatchEvent(new CustomEvent("maizeeye:mission-data-loaded", { detail: { mission, detections } }));
    } catch (err) {
      console.error("Failed to load mission:", err);
      clearLayers();
    }
  }

  setupToggles();

  window.addEventListener("maizeeye:mission-selected", (e) => {
    const missionId = e.detail?.missionId || e.detail?.mission_id || e.detail?.id || e.detail;
    loadMission(missionId);
  });
}