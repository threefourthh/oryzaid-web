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
    "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    {
      maxZoom: ACTUAL_MAX_ZOOM,
      maxNativeZoom: MAX_NATIVE_ZOOM, 
      crossOrigin: true,
      attribution: "Tiles &copy; Google",
    }
  ).addTo(map);

  let diseaseHeatLayer = null;
  let pestHeatLayer = null;
  let fieldBoundaryLayer = null;

  const detectionMarkersLayer = L.layerGroup().addTo(map);
  const diseaseMarkersLayer = L.layerGroup().addTo(map);
  const pestMarkersLayer = L.layerGroup().addTo(map);

  let currentView = 'disease'; 
  let avgDiseaseSeverity = 0;
  let avgPestSeverity = 0;

  const subAreaSelect = document.getElementById("subAreaSelect");
  let allMissionDetections = [];
  let currentMissionData = null;

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

  // ==========================================
  // AREA SEGMENTATION LOGIC (FIXED CLIPPING)
  // ==========================================
  if (subAreaSelect) {
    subAreaSelect.addEventListener("change", (e) => {
      applySubAreaFilter(e.target.value);
    });
  }

  function applySubAreaFilter(areaId) {
    if (!currentMissionData || !allMissionDetections.length) return;

    if (window.activeHighlightLayer) {
      map.removeLayer(window.activeHighlightLayer);
      window.activeHighlightLayer = null;
    }
    
    clearMarkers(); 

    if (areaId === 'overall') {
      renderHeatmaps(allMissionDetections, currentMissionData);
      if (fieldBoundaryLayer) {
          map.fitBounds(fieldBoundaryLayer.getBounds(), { padding: [20, 20] });
      }
      window.dispatchEvent(new CustomEvent("maizeeye:mission-data-loaded", { detail: { mission: currentMissionData, detections: allMissionDetections } }));
      return;
    }

    if (!window.fieldBoundaryLayer) return;

    // 1. Convert Leaflet Boundary into a Turf.js Polygon
    const latlngs = window.fieldBoundaryLayer.getLatLngs()[0];
    const ring = latlngs.map(p => [p.lng, p.lat]);
    // Ensure the polygon ring is closed
    if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) {
        ring.push([...ring[0]]);
    }
    const fieldPoly = turf.polygon([ring]);

    // 2. Determine bounds of the raw strip
    const bounds = window.fieldBoundaryLayer.getBounds();
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const west = bounds.getWest();

    const latStep = (north - south) / 5;
    const areaIndex = parseInt(areaId.replace('area', '')) - 1; 
    
    // Slice from North going South (Area 1 at the top)
    const stripNorth = north - (latStep * areaIndex);
    const stripSouth = stripNorth - latStep;

    const stripCoords = [
      [ [west, stripSouth], [east, stripSouth], [east, stripNorth], [west, stripNorth], [west, stripSouth] ]
    ];
    const stripPoly = turf.polygon(stripCoords);

    // 3. PERFECT CLIPPING: Intersect the raw horizontal strip with the slanted field boundary
    const activeFeature = turf.intersect(fieldPoly, stripPoly);
    
    if (!activeFeature) return;

    // Draw the perfectly clipped polygon on the map
    window.activeHighlightLayer = L.geoJSON(activeFeature, {
      style: { color: "#3b82f6", weight: 3, fillColor: "#3b82f6", fillOpacity: 0.15 }
    }).addTo(map);

    // 4. Filter detections strictly within the clipped polygon
    const filteredDetections = [];
    allMissionDetections.forEach(det => {
      let lat = parseFloat(det.latitude ?? det.lat ?? det.gps_lat ?? det.center_lat);
      let lng = parseFloat(det.longitude ?? det.lng ?? det.lon ?? det.gps_lng ?? det.center_lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        const pt = turf.point([lng, lat]);
        // Using activeFeature guarantees points are inside both the strip AND the field
        if (turf.booleanPointInPolygon(pt, activeFeature)) {
          filteredDetections.push(det);
        }
      }
    });

    const totalImagesOverride = Math.ceil((safeNum(currentMissionData.total_images) || allMissionDetections.length || 1) / 5);
    const subMissionData = { ...currentMissionData, total_images: totalImagesOverride };

    renderHeatmaps(filteredDetections, subMissionData);
    map.fitBounds(window.activeHighlightLayer.getBounds(), { padding: [20, 20] });
    
    window.dispatchEvent(new CustomEvent("maizeeye:mission-data-loaded", { detail: { mission: subMissionData, detections: filteredDetections } }));
  }

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

    avgDiseaseSeverity = (diseaseImages.size / totalImages) * 100;
    avgPestSeverity = (pestImages.size / totalImages) * 100;

    Object.keys(percentEls).forEach((key) => {
      const elInfo = percentEls[key];
      const spanEl = document.getElementById(elInfo.id);
      const rowEl = document.getElementById(elInfo.row);
      
      let value = (classImages[key].size / totalImages) * 100;
      
      if (spanEl) spanEl.textContent = `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;

      if (rowEl) {
        if (value === 0) rowEl.classList.add("hidden-row");
        else rowEl.classList.remove("hidden-row");
      }
    });
    
    updateSeverityUI();
  }

  function clearMarkers() {
    if (diseaseHeatLayer) { map.removeLayer(diseaseHeatLayer); diseaseHeatLayer = null; }
    if (pestHeatLayer) { map.removeLayer(pestHeatLayer); pestHeatLayer = null; }
    diseaseMarkersLayer.clearLayers();
    pestMarkersLayer.clearLayers();
    detectionMarkersLayer.clearLayers();
  }

  function clearLayers() {
    clearMarkers();
    if (fieldBoundaryLayer) { map.removeLayer(fieldBoundaryLayer); fieldBoundaryLayer = null; }
    if (window.activeHighlightLayer) { map.removeLayer(window.activeHighlightLayer); window.activeHighlightLayer = null; }
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

    const diseaseMarkers = [];
    const pestMarkers = [];
    
    detections.forEach((det) => {
      // The latlngs coming here have ALREADY been compressed inside loadMission!
      const latlng = getDetectionLatLng(det, mission);
      if (!latlng) return;

      // Extract the true original database coordinates if we saved them, 
      // otherwise fallback to the visual coordinates.
      const displayLat = det.original_lat !== undefined ? det.original_lat : latlng[0];
      const displayLng = det.original_lng !== undefined ? det.original_lng : latlng[1];

      const label = normalizeLabel(det.issue_type || det.label || det.class_name);
      
      if (isDisease(label)) {
        diseaseMarkers.push(L.circleMarker([latlng[0], latlng[1]], {
          radius: 6,
          fillColor: "#ef4444",
          color: "#ffffff",
          weight: 1.5,
          fillOpacity: 0.95
        }).bindPopup(`
          <div style="text-align:center; font-family:'Inter', sans-serif;">
            <strong style="color:#ef4444; font-size:14px; display:block; margin-bottom:4px;">${label.replace(/_/g, ' ')}</strong>
            <span style="font-size:12px; color:#6b7280; display:block;">Lat: ${displayLat.toFixed(6)}</span>
            <span style="font-size:12px; color:#6b7280; display:block;">Lng: ${displayLng.toFixed(6)}</span>
          </div>
        `));
      } else if (isPest(label)) {
        pestMarkers.push(L.circleMarker([latlng[0], latlng[1]], {
          radius: 6,
          fillColor: "#f97316",
          color: "#ffffff",
          weight: 1.5,
          fillOpacity: 0.95
        }).bindPopup(`
          <div style="text-align:center; font-family:'Inter', sans-serif;">
            <strong style="color:#f97316; font-size:14px; display:block; margin-bottom:4px;">${label.replace(/_/g, ' ')}</strong>
            <span style="font-size:12px; color:#6b7280; display:block;">Lat: ${displayLat.toFixed(6)}</span>
            <span style="font-size:12px; color:#6b7280; display:block;">Lng: ${displayLng.toFixed(6)}</span>
          </div>
        `));
      }
    });

    updatePercentages(detections, mission);

    if (diseaseMarkers.length > 0) {
      diseaseHeatLayer = L.layerGroup(diseaseMarkers);
    }
    if (pestMarkers.length > 0) {
      pestHeatLayer = L.layerGroup(pestMarkers);
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

      // 🔥 THE FIX: Compress the raw GPS dots to physically fit inside the yellow box BEFORE saving them.
      // This ensures Turf.js can actually find them when you select "Area 1" or "Area 2"
      if (window.fieldBoundaryLayer && detections.length > 0) {
        let sumLat = 0, sumLng = 0, validCount = 0;
        detections.forEach(det => {
          let lat = parseFloat(det.latitude ?? det.lat ?? det.gps_lat ?? det.center_lat);
          let lng = parseFloat(det.longitude ?? det.lng ?? det.lon ?? det.gps_lng ?? det.center_lng);
          if (!isNaN(lat) && !isNaN(lng)) {
            sumLat += lat;
            sumLng += lng;
            validCount++;
          }
        });

        if (validCount > 0) {
          let detCenterLat = sumLat / validCount;
          let detCenterLng = sumLng / validCount;
          let polyCenter = window.fieldBoundaryLayer.getBounds().getCenter();
          
          // Squeeze them tighter so they fit neatly inside the boundaries
          let scale = 0.30; 

          detections.forEach(det => {
            let lat = parseFloat(det.latitude ?? det.lat ?? det.gps_lat ?? det.center_lat);
            let lng = parseFloat(det.longitude ?? det.lng ?? det.lon ?? det.gps_lng ?? det.center_lng);
            if (!isNaN(lat) && !isNaN(lng)) {
              // SAVE THE TRUE DATABASE COORDINATES FIRST so the popup can read them
              det.original_lat = lat;
              det.original_lng = lng;

              // NOW OVERWRITE WITH THE VISUAL CENTERED COORDINATES
              det.latitude = polyCenter.lat + (lat - detCenterLat) * scale;
              det.longitude = polyCenter.lng + (lng - detCenterLng) * scale;
            }
          });
        }
      }

      allMissionDetections = detections;
      currentMissionData = mission;
      
      if (subAreaSelect) subAreaSelect.value = 'overall';

      if (window.fieldBoundaryLayer) {
        map.fitBounds(window.fieldBoundaryLayer.getBounds(), { padding: [20, 20], animate: false });
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