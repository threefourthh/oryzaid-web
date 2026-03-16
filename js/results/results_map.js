import { apiGet } from "../core/api.js";

export function initResultsMap({ mapId = "map" } = {}) {
  const SAFE_MAX_ZOOM = 18;

  const map = L.map(mapId, {
    maxZoom: SAFE_MAX_ZOOM,
    preferCanvas: true,
  });
  window.map = map;

  map.setView([17.6132, 121.7269], 18);

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: SAFE_MAX_ZOOM,
      maxNativeZoom: SAFE_MAX_ZOOM,
      crossOrigin: true,
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    }
  ).addTo(map);

  // =========================
  // Layers
  // =========================
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

  const pestBtns = [
    document.getElementById("VGsee"),
  ];

  function resetPercentages() {
    Object.values(percentEls).forEach((el) => {
      if (el) el.textContent = "0%";
    });
  }

  function safeNum(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function firstNonEmpty(...values) {
    for (const v of values) {
      const s = String(v ?? "").trim();
      if (s) return s;
    }
    return "";
  }

  function normalizeMissionPayload(payload) {
    const mission =
      payload?.mission ||
      payload?.data?.mission ||
      payload?.data ||
      payload ||
      {};

    const detections =
      payload?.detections ||
      payload?.mission?.detections ||
      payload?.data?.detections ||
      payload?.results ||
      (Array.isArray(payload?.data) ? payload.data : []) ||
      [];

    return { mission, detections };
  }

  function normalizeLabel(raw) {
    const label = String(raw || "").trim().toLowerCase();

    if (label === "bacterial leaf blight" || label === "bacterial_leaf_blight") return "Bacterial_Leaf_Blight";
    if (label === "fungal spot" || label === "fungal_spot") return "Fungal_Spot";
    if (label === "leaf scald" || label === "leaf_scald") return "Leaf_Scald";
    if (label === "tungro") return "Tungro";
    if (label === "rice hispa" || label === "rice_hispa") return "Rice_Hispa";

    return "Unknown";
  }

  function getDetectionLatLng(det) {
    const lat = safeNum(det.latitude ?? det.lat ?? det.gps_lat ?? det.center_lat);
    const lng = safeNum(det.longitude ?? det.lng ?? det.lon ?? det.gps_lng ?? det.center_lng);

    if (lat == null || lng == null) return null;
    return [lat, lng];
  }

  function getMissionCenter(mission) {
    const lat = safeNum(mission?.center_lat ?? mission?.lat ?? mission?.latitude, 17.6132);
    const lng = safeNum(mission?.center_lng ?? mission?.lng ?? mission?.longitude, 121.7269);
    return [lat, lng];
  }

  function getIntensity(det) {
    const area = safeNum(det.affected_area_percent);
    if (area != null) {
      return Math.max(0.08, Math.min(0.32, area / 260));
    }

    const conf = safeNum(det.confidence);
    if (conf != null) {
      const normalized = conf > 1 ? conf / 100 : conf;
      return Math.max(0.08, Math.min(0.28, normalized * 0.35));
    }

    return 0.12;
  }

  function isDisease(label) {
    return ["Bacterial_Leaf_Blight", "Fungal_Spot", "Leaf_Scald", "Tungro"].includes(label);
  }

  function isPest(label) {
    return ["Rice_Hispa"].includes(label);
  }

  function updatePercentages(detections) {
    const totals = {
      Bacterial_Leaf_Blight: 0,
      Fungal_Spot: 0,
      Leaf_Scald: 0,
      Tungro: 0,
      Rice_Hispa: 0,
    };

    const counts = {
      Bacterial_Leaf_Blight: 0,
      Fungal_Spot: 0,
      Leaf_Scald: 0,
      Tungro: 0,
      Rice_Hispa: 0,
    };

    detections.forEach((det) => {
      const key = normalizeLabel(det.issue_type || det.label || det.class_name);
      if (!(key in totals)) return;

      const area = safeNum(det.affected_area_percent);
      if (area != null) {
        totals[key] += area;
        counts[key] += 1;
      } else {
        totals[key] += 1;
        counts[key] += 1;
      }
    });

    Object.keys(percentEls).forEach((key) => {
      const el = percentEls[key];
      if (!el) return;

      let value = 0;
      if (counts[key] > 0) {
        const looksAreaBased = totals[key] > counts[key];
        value = looksAreaBased ? totals[key] / counts[key] : totals[key];
      }

      value = Math.max(0, Math.min(100, value));
      el.textContent = `${value.toFixed(0)}%`;
    });
  }

  function clearLayers() {
    if (diseaseHeatLayer) {
      map.removeLayer(diseaseHeatLayer);
      diseaseHeatLayer = null;
    }
    if (pestHeatLayer) {
      map.removeLayer(pestHeatLayer);
      pestHeatLayer = null;
    }
    if (fieldBoundaryLayer) {
      map.removeLayer(fieldBoundaryLayer);
      fieldBoundaryLayer = null;
    }

    diseaseMarkersLayer.clearLayers();
    pestMarkersLayer.clearLayers();
    detectionMarkersLayer.clearLayers();

    window.fieldBoundaryLayer = null;
  }

  function makeHeatLayer(points, gradient) {
    return L.heatLayer(points, {
      radius: 22,
      blur: 30,
      maxZoom: 18,
      minOpacity: 0.16,
      gradient,
    });
  }

  function getLayerCanvas(layer) {
    return layer?._canvas || null;
  }

  function setLayerOpacity(layer, value) {
    const canvas = getLayerCanvas(layer);
    if (!canvas) return;
    canvas.style.opacity = String(value);
  }

  function fadeLayer(layer, show, duration = 220) {
    if (!layer) return;

    const canvas = getLayerCanvas(layer);
    if (!canvas) {
      if (show) {
        if (!map.hasLayer(layer)) layer.addTo(map);
      } else {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      }
      return;
    }

    let start = null;
    const from = show ? 0 : 1;
    const to = show ? 1 : 0;

    if (show && !map.hasLayer(layer)) layer.addTo(map);

    canvas.style.transition = "none";
    canvas.style.opacity = String(from);

    function step(ts) {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const value = from + (to - from) * progress;
      canvas.style.opacity = String(value);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        canvas.style.opacity = String(to);
        if (!show && map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      }
    }

    requestAnimationFrame(step);
  }

  function applyVisibility() {
    if (diseaseHeatLayer) fadeLayer(diseaseHeatLayer, diseaseVisible);
    if (pestHeatLayer) fadeLayer(pestHeatLayer, pestVisible);

    if (diseaseVisible) {
      if (!map.hasLayer(diseaseMarkersLayer)) map.addLayer(diseaseMarkersLayer);
      diseaseMarkersLayer.eachLayer((layer) => {
        if (layer.bringToFront) layer.bringToFront();
      });
    } else {
      if (map.hasLayer(diseaseMarkersLayer)) map.removeLayer(diseaseMarkersLayer);
    }

    if (pestVisible) {
      if (!map.hasLayer(pestMarkersLayer)) map.addLayer(pestMarkersLayer);
      pestMarkersLayer.eachLayer((layer) => {
        if (layer.bringToFront) layer.bringToFront();
      });
    } else {
      if (map.hasLayer(pestMarkersLayer)) map.removeLayer(pestMarkersLayer);
    }

    if (fieldBoundaryLayer && fieldBoundaryLayer.bringToFront) {
      fieldBoundaryLayer.bringToFront();
    }
  }

  function setButtonsState(buttons, visible) {
    buttons.forEach((btn) => {
      if (!btn) return;
      btn.dataset.active = visible ? "1" : "0";
      btn.style.opacity = visible ? "1" : "0.55";

      const img = btn.querySelector("img");
      if (img) {
        img.src = "assets/icons/view.png";
        img.style.opacity = visible ? "1" : "0.45";
      }
    });
  }

  function updateLayerChip(id, label, isOn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = `${label}: ${isOn ? "ON" : "OFF"}`;
    el.classList.remove("on", "off");
    el.classList.add(isOn ? "on" : "off");
  }

  function syncLayerStatusBar() {
    updateLayerChip("chipDisease", "Diseases", diseaseVisible);
    updateLayerChip("chipPest", "Pests", pestVisible);
  }

  function syncAllButtonStates() {
    setButtonsState(diseaseBtns, diseaseVisible);
    setButtonsState(pestBtns, pestVisible);
    syncLayerStatusBar();
  }

  function markerPopupHtml(det) {
    const label = normalizeLabel(det.issue_type || det.label || det.class_name);
    const displayName = firstNonEmpty(det.class_name, det.label, det.issue_type, label);
    const severity = firstNonEmpty(det.severity_level, det.severity, "—");
    const group = firstNonEmpty(det.class_group, "—");

    const confidenceRaw = safeNum(det.confidence);
    const confidenceText =
      confidenceRaw == null
        ? "—"
        : `${((confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw) * 100).toFixed(1)}%`;

    const areaRaw = safeNum(det.affected_area_percent);
    const areaText = areaRaw == null ? "—" : `${areaRaw.toFixed(1)}%`;

    return `
      <div style="min-width:180px;">
        <strong>${displayName}</strong><br>
        Group: ${group}<br>
        Severity: ${severity}<br>
        Confidence: ${confidenceText}<br>
        Affected Area: ${areaText}
      </div>
    `;
  }

  function renderFieldBoundary(mission) {
    const raw =
      mission?.field_boundary ||
      mission?.polygon ||
      mission?.boundary_points ||
      mission?.drawn_polygon ||
      mission?.field_polygon ||
      [];

    if (!Array.isArray(raw) || !raw.length) return [];

    const latlngs = raw
      .map((p) => {
        if (Array.isArray(p) && p.length >= 2) {
          const lat = safeNum(p[0]);
          const lng = safeNum(p[1]);
          return lat != null && lng != null ? [lat, lng] : null;
        }

        const lat = safeNum(p?.lat ?? p?.latitude);
        const lng = safeNum(p?.lng ?? p?.longitude);
        return lat != null && lng != null ? [lat, lng] : null;
      })
      .filter(Boolean);

    if (latlngs.length < 3) return [];

    fieldBoundaryLayer = L.polygon(latlngs, {
      color: "#F6CF3A",
      weight: 4,
      fillColor: "#F6CF3A",
      fillOpacity: 0.15,
    })
      .bindPopup("Field Boundary")
      .addTo(map);

    window.fieldBoundaryLayer = fieldBoundaryLayer;
    return latlngs;
  }

  function getMarkerColor(label) {
    if (isDisease(label)) return "#ef4444";
    if (isPest(label)) return "#f59e0b";
    return "#94a3b8";
  }

  function renderDetectionMarkers(detections) {
    const bounds = [];

    detections.forEach((det) => {
      const latlng = getDetectionLatLng(det);
      if (!latlng) return;

      const label = normalizeLabel(det.issue_type || det.label || det.class_name);
      const color = getMarkerColor(label);

      const marker = L.circleMarker(latlng, {
        radius: 4,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.7,
      }).bindPopup(markerPopupHtml(det));

      detectionMarkersLayer.addLayer(marker);

      if (isDisease(label)) diseaseMarkersLayer.addLayer(marker);
      else if (isPest(label)) pestMarkersLayer.addLayer(marker);

      bounds.push(latlng);
    });

    return bounds;
  }

  function renderHeatmaps(detections) {
    resetPercentages();

    if (!Array.isArray(detections) || detections.length === 0) return;

    const diseasePoints = [];
    const pestPoints = [];

    detections.forEach((det) => {
      const label = normalizeLabel(det.issue_type || det.label || det.class_name);
      const latlng = getDetectionLatLng(det);
      if (!latlng) return;

      const intensity = getIntensity(det);
      const point = [latlng[0], latlng[1], intensity];

      if (isDisease(label)) diseasePoints.push(point);
      else if (isPest(label)) pestPoints.push(point);
    });

    updatePercentages(detections);

    if (diseasePoints.length > 0) {
      diseaseHeatLayer = makeHeatLayer(diseasePoints, {
        0.20: "#ffe3e3",
        0.45: "#ffb0b0",
        0.70: "#ff6b6b",
        1.00: "#d62828",
      });
    }

    if (pestPoints.length > 0) {
      pestHeatLayer = makeHeatLayer(pestPoints, {
        0.2: "#ffe0b3",
        0.4: "#ffb84d",
        0.7: "#ff8c1a",
        1.0: "#cc6600",
      });
    }

    if (diseaseHeatLayer && diseaseVisible) diseaseHeatLayer.addTo(map);
    if (pestHeatLayer && pestVisible) pestHeatLayer.addTo(map);

    setTimeout(() => {
      setLayerOpacity(diseaseHeatLayer, diseaseVisible ? 1 : 0);
      setLayerOpacity(pestHeatLayer, pestVisible ? 1 : 0);
    }, 60);

    syncAllButtonStates();
  }

  function addLegend() {
    const legend = L.control({ position: "bottomright" });

    legend.onAdd = function () {
      const div = L.DomUtil.create("div", "maizeeye-legend");

      div.innerHTML = `
        <div class="legend-title">Detection Heatmap</div>
        <div class="legend-item"><span class="legend-label">Diseases</span><div class="legend-gradient disease"></div></div>
        <div class="legend-item"><span class="legend-label">Pests</span><div class="legend-gradient pest"></div></div>
        <div class="legend-scale"><span>Low</span><span>Moderate</span><span>Severe</span></div>
      `;

      return div;
    };

    legend.addTo(map);
  }

  function frameMissionView(mission, detectionBounds) {
    if (fieldBoundaryLayer && typeof fieldBoundaryLayer.getBounds === "function") {
      const bounds = fieldBoundaryLayer.getBounds();
      if (bounds && typeof bounds.isValid === "function" && bounds.isValid()) {
        const center = bounds.getCenter();
        const zoom = Math.min(map.getBoundsZoom(bounds, false, L.point(80, 80)), SAFE_MAX_ZOOM);
        map.setView(center, zoom, { animate: false });
        return;
      }
    }

    if (detectionBounds.length > 1) {
      const bounds = L.latLngBounds(detectionBounds);
      const center = bounds.getCenter();
      const zoom = Math.min(map.getBoundsZoom(bounds, false, L.point(60, 60)), SAFE_MAX_ZOOM);
      map.setView(center, zoom, { animate: false });
      return;
    }

    if (detectionBounds.length === 1) {
      map.setView(detectionBounds[0], Math.min(18, SAFE_MAX_ZOOM), { animate: false });
      return;
    }

    const missionCenter = getMissionCenter(mission);
    map.setView(missionCenter, Math.min(18, SAFE_MAX_ZOOM), { animate: false });
  }

  async function loadMission(missionId) {
    if (!missionId) return;

    try {
      const payload = await apiGet(`/missions/${encodeURIComponent(missionId)}`);
      const { mission, detections } = normalizeMissionPayload(payload);

      clearLayers();

      const boundaryBounds = renderFieldBoundary(mission);
      const detectionBounds = renderDetectionMarkers(detections);
      renderHeatmaps(detections);

      if (fieldBoundaryLayer && fieldBoundaryLayer.bringToFront) {
        fieldBoundaryLayer.bringToFront();
      }

      applyVisibility();
      frameMissionView(mission, [...boundaryBounds, ...detectionBounds]);

      window.dispatchEvent(
        new CustomEvent("maizeeye:mission-data-loaded", {
          detail: { mission, detections },
        })
      );

      setTimeout(() => map.invalidateSize(), 150);
    } catch (err) {
      console.error("Failed to load mission detections:", err);
      clearLayers();
      resetPercentages();
    }
  }

  function bindGroupToggle(buttons, getter, setter) {
    buttons.forEach((btn) => {
      btn?.addEventListener("click", () => {
        setter(!getter());
        applyVisibility();
        syncAllButtonStates();
      });
    });
  }

  bindGroupToggle(diseaseBtns, () => diseaseVisible, (v) => {
    diseaseVisible = v;
  });

  bindGroupToggle(pestBtns, () => pestVisible, (v) => {
    pestVisible = v;
  });

  window.addEventListener("maizeeye:mission-selected", (e) => {
    const missionId = e.detail?.missionId || e.detail?.mission_id || e.detail?.id || e.detail;
    loadMission(missionId);
  });

  addLegend();
  syncAllButtonStates();
  setTimeout(() => map.invalidateSize(), 200);
}