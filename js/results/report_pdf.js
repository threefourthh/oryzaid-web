// js/results/report_pdf.js
import { showCenterNotif } from "../drawmap/center_notif.js";

let cachedMission = null;
let cachedDetections = [];

window.addEventListener("maizeeye:mission-data-loaded", (e) => {
  cachedMission = e?.detail?.mission || null;
  cachedDetections = Array.isArray(e?.detail?.detections) ? e.detail.detections : [];
});

function getParam(name) {
  const p = new URLSearchParams(window.location.search);
  return (p.get(name) || "").trim();
}

function getText(id) {
  const el = document.getElementById(id);
  if (!el) return "";
  return (el.textContent || "").trim();
}

function missionId() {
  return (
    getParam("mission_id") || getParam("mission") || getText("metaMissionId") || "unknown_mission"
  );
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nowTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function safeNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getFieldValue(...values) {
  for (const v of values) {
    const t = String(v || "").trim();
    if (t && t !== "—") return t;
  }
  return "—";
}

function getPercentText(id) {
  const el = document.getElementById(id);
  if (!el) return "0%";
  const t = (el.textContent || "").trim();
  return t || "0%";
}

function normalizePercent(t) {
  const n = parseFloat(String(t).replace("%", "").trim());
  return Number.isFinite(n) ? n : 0;
}

function cropCanvasCenter(sourceCanvas, cropRatio = 0.68) {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;

  if (!sw || !sh) {
    throw new Error("Source canvas is empty");
  }

  const cw = Math.max(1, Math.round(sw * cropRatio));
  const ch = Math.max(1, Math.round(sh * cropRatio));

  const sx = Math.round((sw - cw) / 2);
  const sy = Math.round((sh - ch) / 2);

  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;

  const ctx = out.getContext("2d");
  ctx.drawImage(sourceCanvas, sx, sy, cw, ch, 0, 0, cw, ch);

  return {
    canvas: out,
    jpegData: out.toDataURL("image/jpeg", 0.95),
  };
}

async function captureEl(el, label) {
  if (!el) throw new Error(`${label} element not found`);

  const canvas = await window.html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });

  if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
    throw new Error(`${label} capture failed (canvas empty)`);
  }

  return {
    canvas,
    jpegData: canvas.toDataURL("image/jpeg", 0.95),
  };
}

function writeKeyValue(pdf, x, y, key, value) {
  pdf.setFont("helvetica", "bold");
  pdf.text(`${key}:`, x, y);
  pdf.setFont("helvetica", "normal");
  pdf.text(String(value ?? "—"), x + 38, y);
}

function drawSectionTitle(pdf, title, x, y) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(0, 0, 0);
  pdf.text(title, x, y);
}

function drawColorLegendItem(pdf, x, y, color, label) {
  pdf.setFillColor(color[0], color[1], color[2]);
  pdf.setDrawColor(color[0], color[1], color[2]);
  pdf.roundedRect(x, y - 4, 8, 8, 1, 1, "F");

  pdf.setTextColor(0, 0, 0);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(label, x + 12, y + 1);
}

function drawLineLegendItem(pdf, x, y, options = {}) {
  const {
    label = "Legend Item",
    color = [0, 0, 0],
    dashed = false,
    circle = false,
    fill = false,
  } = options;

  pdf.setDrawColor(color[0], color[1], color[2]);
  pdf.setFillColor(color[0], color[1], color[2]);

  if (circle) {
    if (fill) pdf.circle(x + 4, y, 3, "F");
    else pdf.circle(x + 4, y, 3, "S");
  } else {
    if (dashed) pdf.setLineDashPattern([1.5, 1.5], 0);
    else pdf.setLineDashPattern([], 0);

    pdf.setLineWidth(1.2);
    pdf.line(x, y, x + 10, y);
    pdf.setLineDashPattern([], 0);
  }

  pdf.setTextColor(0, 0, 0);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(label, x + 14, y + 1);
}

function drawWrappedText(pdf, text, x, y, maxWidth, lineHeight = 5) {
  const lines = pdf.splitTextToSize(String(text || ""), maxWidth);
  pdf.text(lines, x, y);
  return y + lines.length * lineHeight;
}

function ensurePageSpace(pdf, y, needed = 20, resetY = 18) {
  const pageH = pdf.internal.pageSize.getHeight();
  if (y + needed > pageH - 15) {
    pdf.addPage();
    return resetY;
  }
  return y;
}

function addFittedImage(pdf, jpegData, imgWpx, imgHpx, x, y, maxW, maxH) {
  const ratio = Math.min(maxW / imgWpx, maxH / imgHpx);
  const w = imgWpx * ratio;
  const h = imgHpx * ratio;
  const dx = x + (maxW - w) / 2;
  const dy = y + (maxH - h) / 2;

  pdf.addImage(jpegData, "JPEG", dx, dy, w, h);
  return { x: dx, y: dy, w, h };
}

function addCenteredMapImage(pdf, mapShot, topY = 54) {
  const pageW = pdf.internal.pageSize.getWidth();
  const sideMargin = 14;
  const mapBox = {
    x: sideMargin,
    y: topY,
    w: pageW - sideMargin * 2,
    h: 142,
  };

  pdf.setDrawColor(210, 210, 210);
  pdf.roundedRect(mapBox.x, mapBox.y, mapBox.w, mapBox.h, 3, 3, "S");
  addFittedImage(
    pdf,
    mapShot.jpegData,
    mapShot.canvas.width,
    mapShot.canvas.height,
    mapBox.x,
    mapBox.y,
    mapBox.w,
    mapBox.h
  );
}

function hideLiveMapUIForCapture() {
  const selectors = [
    ".leaflet-control-zoom",
    ".maizeeye-legend",
    ".leaflet-control-attribution",
    ".leaflet-popup",
    ".layer-status-bar",
  ];

  const changed = [];
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      changed.push([el, el.style.visibility]);
      el.style.visibility = "hidden";
    });
  });

  return () => {
    changed.forEach(([el, prev]) => {
      el.style.visibility = prev;
    });
  };
}

async function waitForLeafletTiles(mapEl, timeoutMs = 2200) {
  if (!mapEl) return;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tiles = Array.from(mapEl.querySelectorAll(".leaflet-tile"));
    if (!tiles.length) {
      await wait(100);
      continue;
    }
    const notReady = tiles.some((img) => !img.complete || img.naturalWidth === 0);
    if (!notReady) return;
    await wait(120);
  }
}

async function waitForMapStable(map) {
  if (!map) return;
  await nextFrame();
  await nextFrame();
  await wait(350);
}

async function captureVisibleMapFallback() {
  const mapEl = document.getElementById("map");
  if (!mapEl) throw new Error("Map element not found");

  const map = window.map;
  const oldScrollX = window.scrollX;
  const oldScrollY = window.scrollY;
  const restoreUI = hideLiveMapUIForCapture();

  try {
    mapEl.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });
    await nextFrame();
    await wait(250);

    if (map && typeof map.invalidateSize === "function") map.invalidateSize(true);

    await waitForMapStable(map);
    await waitForLeafletTiles(mapEl, 2200);
    await wait(250);

    return await captureEl(mapEl, "Map");
  } finally {
    restoreUI();
    window.scrollTo(oldScrollX, oldScrollY);
    await wait(80);
  }
}

function getMissionCenterLatLng(mission) {
  const lat = safeNum(mission?.center_lat ?? mission?.lat ?? mission?.latitude, 17.6132);
  const lng = safeNum(mission?.center_lng ?? mission?.lng ?? mission?.longitude, 121.7269);
  return [lat, lng];
}

function getBoundaryLatLngs(mission) {
  const raw =
    mission?.field_boundary ||
    mission?.polygon ||
    mission?.boundary_points ||
    mission?.drawn_polygon ||
    mission?.field_polygon ||
    [];

  if (!Array.isArray(raw) || !raw.length) return [];

  return raw
    .map((p) => {
      if (Array.isArray(p) && p.length >= 2) {
        return safeNum(p[0]) != null && safeNum(p[1]) != null
          ? [safeNum(p[0]), safeNum(p[1])]
          : null;
      }
      const lat = safeNum(p?.lat ?? p?.latitude);
      const lng = safeNum(p?.lng ?? p?.longitude);
      return lat != null && lng != null ? [lat, lng] : null;
    })
    .filter(Boolean);
}

function getDetectionLatLng(det) {
  const lat = safeNum(det.latitude ?? det.lat ?? det.gps_lat ?? det.center_lat);
  const lng = safeNum(det.longitude ?? det.lng ?? det.lon ?? det.gps_lng ?? det.center_lng);
  if (lat == null || lng == null) return null;
  return [lat, lng];
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

function makeHeatLayer(points, gradient) {
  return L.heatLayer(points, {
    radius: 22,
    blur: 30,
    maxZoom: 18,
    minOpacity: 0.16,
    gradient,
  });
}

function waitForExportTiles(mapEl, timeoutMs = 3200) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const tiles = Array.from(mapEl.querySelectorAll(".leaflet-tile"));
      if (!tiles.length) {
        if (Date.now() - start >= timeoutMs) return resolve();
        return setTimeout(tick, 100);
      }
      const notReady = tiles.some((img) => !img.complete || img.naturalWidth === 0);
      if (!notReady) return resolve();
      if (Date.now() - start >= timeoutMs) return resolve();
      setTimeout(tick, 120);
    };
    tick();
  });
}

async function captureExportMap() {
  const mission = cachedMission || window.currentResultsMission || null;
  const detections =
    Array.isArray(cachedDetections) && cachedDetections.length
      ? cachedDetections
      : Array.isArray(window.currentResultsDetections)
      ? window.currentResultsDetections
      : [];

  if (!mission) {
    return await captureVisibleMapFallback();
  }

  let host = null;
  let exportMap = null;

  try {
    host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.style.width = "1100px";
    host.style.height = "800px";
    host.style.background = "#ffffff";
    host.style.zIndex = "-1";
    document.body.appendChild(host);

    exportMap = L.map(host, {
      zoomControl: false,
      attributionControl: false,
      maxZoom: 18,
      preferCanvas: true,
    });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 18,
        maxNativeZoom: 18,
        crossOrigin: true,
        attribution: "Tiles &copy; Esri",
      }
    ).addTo(exportMap);

    const missionCenter = getMissionCenterLatLng(mission);
    const boundaryLatLngs = getBoundaryLatLngs(mission);

    let boundaryLayer = null;

    if (boundaryLatLngs.length >= 3) {
      boundaryLayer = L.polygon(boundaryLatLngs, {
        color: "#F6CF3A",
        weight: 4,
        fillColor: "#F6CF3A",
        fillOpacity: 0.15,
      }).addTo(exportMap);
    }

    let exportBounds = null;
    if (boundaryLayer && typeof boundaryLayer.getBounds === "function") {
      exportBounds = boundaryLayer.getBounds();
    }

    const diseasePoints = [];
    const pestPoints = [];
    const filterBounds = exportBounds ? exportBounds.pad(0.1) : null;

    detections.forEach((det) => {
      const latlng = getDetectionLatLng(det);
      if (!latlng) return;
      if (filterBounds && !filterBounds.contains(latlng)) return;

      const label = normalizeLabel(det.issue_type || det.label || det.class_name);
      const point = [latlng[0], latlng[1], getIntensity(det)];

      if (isDisease(label)) diseasePoints.push(point);
      else if (isPest(label)) pestPoints.push(point);

      const color = isDisease(label)
        ? "#ef4444"
        : isPest(label)
        ? "#f59e0b"
        : "#94a3b8";

      L.circleMarker(latlng, {
        radius: 4,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.7,
      }).addTo(exportMap);
    });

    if (diseasePoints.length) {
      makeHeatLayer(diseasePoints, {
        0.20: "#ffe3e3",
        0.45: "#ffb0b0",
        0.70: "#ff6b6b",
        1.00: "#d62828",
      }).addTo(exportMap);
    }

    if (pestPoints.length) {
      makeHeatLayer(pestPoints, {
        0.20: "#fff0d9",
        0.45: "#ffd08a",
        0.70: "#ffad33",
        1.00: "#d97706",
      }).addTo(exportMap);
    }

    if (boundaryLayer && boundaryLayer.bringToFront) boundaryLayer.bringToFront();

    exportMap.invalidateSize(false);

    if (exportBounds && typeof exportBounds.isValid === "function" && exportBounds.isValid()) {
      exportMap.fitBounds(exportBounds, {
        paddingTopLeft: L.point(5, 5),
        paddingBottomRight: L.point(5, 5),
        maxZoom: 18,
        animate: false,
      });
    } else {
      exportMap.setView(missionCenter, 18, { animate: false });
    }

    await nextFrame();
    await nextFrame();
    await wait(450);
    await waitForExportTiles(host, 3200);
    await wait(250);

    const canvas = await window.html2canvas(host, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      ignoreElements: (el) => {
        const cl = el.classList;
        return !!(
          cl?.contains("leaflet-control-container") ||
          cl?.contains("maizeeye-legend") ||
          cl?.contains("layer-status-bar")
        );
      },
    });

    if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
      throw new Error("Export map capture failed");
    }

    return cropCanvasCenter(canvas, 0.55);
  } catch (err) {
    console.warn("Export-map capture failed, falling back to visible map:", err);
    return await captureVisibleMapFallback();
  } finally {
    try {
      if (exportMap) exportMap.remove();
    } catch {}
    try {
      if (host && host.parentNode) host.parentNode.removeChild(host);
    } catch {}
  }
}

function getDetectedIssues(diseases, pests) {
  return [...diseases, ...pests]
    .map((item) => ({
      ...item,
      value: normalizePercent(getPercentText(item.id)),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

function getGroupStats(items) {
  const values = items.map((item) => normalizePercent(getPercentText(item.id)));
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = values.length ? sum / values.length : 0;
  const max = values.length ? Math.max(...values) : 0;
  return { sum, avg, max };
}

function getSeverityLabel(value) {
  if (value >= 50) return "High";
  if (value >= 20) return "Medium";
  if (value > 0) return "Low";
  return "None";
}

function buildAssessment(diseaseStats, pestStats) {
  const groups = [
    { key: "Disease", label: "Diseases", score: diseaseStats.max },
    { key: "Pest", label: "Pests", score: pestStats.max },
  ].sort((a, b) => b.score - a.score);

  const dominant = groups[0];
  const severity = getSeverityLabel(dominant.score);

  return {
    dominantType: dominant.key,
    dominantLabel: dominant.label,
    dominantScore: dominant.score,
    dominantSeverity: severity,
  };
}

function buildRecommendations(assessment, detected) {
  if (!detected.length) {
    return [
      "No major visible issue was detected in this mission based on the available summary.",
      "Continue regular crop monitoring and repeat drone scanning to confirm field condition over time.",
      "Maintain normal field observation, especially after rainfall, strong heat, or sudden crop discoloration.",
    ];
  }

  const tips = [];
  const { dominantType, dominantSeverity } = assessment;

  if (dominantType === "Disease") {
    if (dominantSeverity === "High") {
      tips.push(
        "Disease presence appears high in the most affected zones. Inspect these areas immediately and isolate the worst-affected sections if possible.",
        "Consult a local agriculturist soon regarding suitable disease control measures and the proper timing of fungicide application.",
        "Prioritize sanitation by removing heavily infected leaves or plant debris when practical to help reduce further spread."
      );
    } else if (dominantSeverity === "Medium") {
      tips.push(
        "Disease indicators are at a moderate level. Inspect the affected parts of the field closely within the next monitoring cycle.",
        "Track whether leaf damage is spreading and prepare early treatment if symptoms continue increasing.",
        "Keep the field clean and avoid leaving infected plant material in place for too long."
      );
    } else {
      tips.push(
        "Only low disease presence was observed. Continue close monitoring of affected leaves before the issue becomes more widespread.",
        "Mark the affected zones and recheck them in the next scan for changes in severity."
      );
    }
  }

  if (dominantType === "Pest") {
    if (dominantSeverity === "High") {
      tips.push(
        "Pest-related damage appears high in the most affected zones. Field inspection should be done as soon as possible.",
        "Check the crop early in the morning or late afternoon to confirm active pest presence and feeding damage.",
        "Apply integrated pest management practices and consult local agriculture officers before using pesticide treatment."
      );
    } else if (dominantSeverity === "Medium") {
      tips.push(
        "Pest activity appears moderate. Inspect the identified zones and monitor whether feeding damage is increasing.",
        "Focus first on the most affected sections to reduce the chance of wider spread across the field."
      );
    } else {
      tips.push(
        "Only low pest activity was observed. Continue spot-checking plants in the highlighted zones.",
        "Maintain regular monitoring so early pest buildup can be addressed quickly."
      );
    }
  }

  const labels = detected.map((d) => d.label);

  if (
    labels.includes("Bacterial Leaf Blight") ||
    labels.includes("Fungal Spot") ||
    labels.includes("Leaf Scald") ||
    labels.includes("Tungro")
  ) {
    tips.push("Inspect rice leaves closely for visible lesions, blight patterns, or discoloration in the highlighted areas.");
  }
  if (labels.includes("Rice Hispa")) {
    tips.push("Look for chewing damage and insect presence in the highlighted sections, especially around younger plants.");
  }

  tips.push(
    "Focus first on the zones with the strongest heatmap intensity because these are likely the most urgent areas.",
    "Run another monitoring flight after corrective action to compare changes in crop condition."
  );

  return [...new Set(tips)];
}

function buildNoticeText() {
  return [
    "Notice:",
    "Red = plant disease, Orange = pest-related damage.",
    "Yellow line = field boundary.",
    "Stronger color intensity usually means the detected issue is more severe.",
  ].join(" ");
}

export function initReportPDF({ btnId = "downloadPdfBtn" } = {}) {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const oldText = btn.textContent;

    try {
      btn.disabled = true;
      btn.textContent = "Generating...";

      showCenterNotif("Preparing mission report...", { showOk: false });
      document.body.classList.add("pdf-exporting");
      await wait(150);

      showCenterNotif("Capturing map for PDF...", { showOk: false });
      const mapShot = await captureExportMap();

      showCenterNotif("Generating PDF...", { showOk: false });

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("p", "mm", "a4");

      const place = getFieldValue(getParam("place"), getText("metaPlace"));
      const areaHa = getFieldValue(getParam("area_ha"), getText("metaArea"));
      const altitudeM = getFieldValue(getParam("alt_m"), getText("metaAltitude"));

      const generatedDate = todayISO();
      const generatedTime = nowTime();

      const diseases = [
        { label: "Bacterial Leaf Blight", id: "Commonrust", type: "Disease" },
        { label: "Fungal Spot", id: "NCLB", type: "Disease" },
        { label: "Leaf Scald", id: "GrayLeafSpot", type: "Disease" },
        { label: "Tungro", id: "FAW", type: "Disease" },
      ];

      const pests = [
        { label: "Rice Hispa", id: "grasshopper", type: "Pest" },
      ];

      const detected = getDetectedIssues(diseases, pests);
      const diseaseStats = getGroupStats(diseases);
      const pestStats = getGroupStats(pests);

      const assessment = buildAssessment(diseaseStats, pestStats);
      const recommendations = buildRecommendations(assessment, detected);
      const noticeText = buildNoticeText();

      // PAGE 1
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.setTextColor(0, 0, 0);
      pdf.text("OryzAID Mission Report", 14, 16);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      writeKeyValue(pdf, 14, 24, "Mission ID", missionId());
      writeKeyValue(pdf, 14, 30, "Place", place);
      writeKeyValue(pdf, 14, 36, "Area (ha)", areaHa);
      writeKeyValue(pdf, 14, 42, "Altitude (m)", altitudeM);
      writeKeyValue(pdf, 14, 48, "Generated", `${generatedDate} ${generatedTime}`);

      addCenteredMapImage(pdf, mapShot, 54);

      let y = 205;

      drawSectionTitle(pdf, "Map Legend", 14, y);
      y += 8;
      drawLineLegendItem(pdf, 16, y, {
        label: "Field Boundary",
        color: [255, 204, 0],
        dashed: false,
      });

      y = 205;

      drawSectionTitle(pdf, "Detection Legend", 108, y);
      y += 8;
      drawColorLegendItem(pdf, 110, y, [220, 53, 69], "Diseases");
      y += 8;
      drawColorLegendItem(pdf, 110, y, [255, 140, 0], "Pests");

      y = 232;

      drawSectionTitle(pdf, "Severity Guide", 14, y);
      y += 6;

      pdf.setDrawColor(220, 220, 220);
      pdf.setFillColor(250, 250, 250);
      pdf.roundedRect(14, y - 2, 182, 24, 2, 2, "FD");

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.5);
      pdf.text("Low - Minor affected area", 18, y + 5);
      pdf.text("Moderate - Noticeable spread", 18, y + 11);
      pdf.text("Severe - Large affected area / urgent attention needed", 18, y + 17);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text("Generated by OryzAID Results Dashboard", 14, 289);

      // PAGE 2
      pdf.addPage();

      let py = 18;

      drawSectionTitle(pdf, "Detection Summary and Recommendations", 14, py);
      py += 12;

      drawSectionTitle(pdf, "Detected Issues", 14, py);
      py += 8;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);

      if (!detected.length) {
        pdf.text(
          "No visible disease or pest issue was recorded in the current summary.",
          16,
          py
        );
        py += 8;
      } else {
        detected.forEach((item, idx) => {
          py = ensurePageSpace(pdf, py, 8);
          pdf.text(
            `${idx + 1}. ${item.label} (${item.type}) - ${item.value.toFixed(1)}%`,
            16,
            py
          );
          py += 7;
        });
      }

      py += 4;

      drawSectionTitle(pdf, "Field Assessment", 14, py);
      py += 8;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);

      py = drawWrappedText(
        pdf,
        detected.length
          ? `The report shows that ${assessment.dominantLabel.toLowerCase()} are the most dominant concern in this mission, with an overall ${assessment.dominantSeverity.toLowerCase()} severity pattern based on the highest detected percentage.`
          : "The report currently shows no strong visible indication of disease or pest from the available summary.",
        16,
        py,
        175,
        5
      );

      py += 6;

      drawSectionTitle(pdf, "Detailed Detection Summary", 14, py);
      py += 8;

      const row = (name, pct) => {
        py = ensurePageSpace(pdf, py, 10);
        pdf.setFont("helvetica", "normal");
        pdf.text(name, 16, py);
        pdf.text(pct, 190, py, { align: "right" });
        py += 7;
      };

      const section = (title) => {
        py = ensurePageSpace(pdf, py, 12);
        pdf.setFont("helvetica", "bold");
        pdf.text(title.toUpperCase(), 14, py);
        py += 8;
      };

      section("Diseases");
      diseases.forEach((d) => row(d.label, getPercentText(d.id)));
      py += 2;

      section("Pests");
      pests.forEach((p) => row(p.label, getPercentText(p.id)));
      py += 6;

      const all = [...diseases, ...pests].map((x) =>
        normalizePercent(getPercentText(x.id))
      );
      const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;

      py = ensurePageSpace(pdf, py, 18);
      pdf.setFont("helvetica", "bold");
      pdf.text("Overall Severity (avg)", 14, py);
      pdf.text(`${avg.toFixed(1)}%`, 190, py, { align: "right" });
      py += 12;

      drawSectionTitle(pdf, "Suggested Farmer Actions", 14, py);
      py += 8;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);

      recommendations.forEach((tip, index) => {
        py = ensurePageSpace(pdf, py, 12);
        py = drawWrappedText(pdf, `${index + 1}. ${tip}`, 16, py, 175, 5);
        py += 1;
      });

      py += 8;
      py = ensurePageSpace(pdf, py, 22);

      drawSectionTitle(pdf, "How to Read This Report", 14, py);
      py += 6;

      pdf.setDrawColor(210, 210, 210);
      pdf.setFillColor(248, 248, 248);
      pdf.roundedRect(14, py - 4, 182, 18, 2, 2, "FD");

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);
      pdf.setTextColor(70, 70, 70);
      drawWrappedText(pdf, noticeText, 18, py + 1, 172, 4.2);

      pdf.setTextColor(0, 0, 0);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text("Generated by OryzAID Results Dashboard", 14, 289);

      const file = `OryzAID_Report_${missionId()}_${generatedDate}.pdf`;
      pdf.save(file);

      showCenterNotif("PDF report downloaded successfully!", {
        showOk: true,
        okText: "OK",
      });
    } catch (err) {
      console.error("PDF export failed:", err);
      showCenterNotif("PDF generation failed. Please try again.", {
        showOk: true,
        okText: "OK",
      });
    } finally {
      document.body.classList.remove("pdf-exporting");
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });
}