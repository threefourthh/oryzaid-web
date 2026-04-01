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

function cropCanvasCenter(sourceCanvas, cropRatio = 1.0) {
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

  return {
    canvas,
    jpegData: canvas.toDataURL("image/jpeg", 0.95),
  };
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

  return raw.map((p) => {
    if (Array.isArray(p) && p.length >= 2) return [safeNum(p[0]), safeNum(p[1])];
    return [safeNum(p?.lat ?? p?.latitude), safeNum(p?.lng ?? p?.longitude)];
  }).filter(p => p[0] != null && p[1] != null);
}

function getDetectionLatLng(det) {
  const lat = safeNum(det.latitude ?? det.lat ?? det.gps_lat ?? det.center_lat);
  const lng = safeNum(det.longitude ?? det.lng ?? det.lon ?? det.gps_lng ?? det.center_lng);
  if (lat == null || lng == null) return null;
  return [lat, lng];
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

function isDisease(label) {
  return ["Bacterial_Leaf_Blight", "Fungal_Spot", "Leaf_Scald", "Tungro"].includes(label);
}

function isPest(label) {
  return ["Rice_Hispa"].includes(label);
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

async function captureExportMap(filterType) {
  const mission = cachedMission || window.currentResultsMission || null;
  const realDetections = Array.isArray(cachedDetections) && cachedDetections.length ? cachedDetections : [];
  let detectionsToUse = [...realDetections];

  if (!mission) return await captureVisibleMapFallback();

  let host = null;
  let exportMap = null;

  try {
    host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.style.width = "800px";
    host.style.height = "600px";
    host.style.background = "#ffffff";
    document.body.appendChild(host);

    exportMap = L.map(host, { zoomControl: false, attributionControl: false, maxZoom: 19, preferCanvas: true });

    // Use Esri World Street Map for the light base
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, maxNativeZoom: 18, crossOrigin: true
    }).addTo(exportMap);

    const missionCenter = getMissionCenterLatLng(mission);
    const boundaryLatLngs = getBoundaryLatLngs(mission);
    let boundaryLayer = null;

    if (boundaryLatLngs.length >= 3) {
      boundaryLayer = L.polygon(boundaryLatLngs, {
        color: "#F6CF3A", weight: 4, fillColor: "#F6CF3A", fillOpacity: 0.15,
      }).addTo(exportMap);
    }

    const exportBounds = boundaryLayer && typeof boundaryLayer.getBounds === "function" ? boundaryLayer.getBounds() : null;
    const dotLayer = L.layerGroup();

    detectionsToUse.forEach((det) => {
      const latlng = getDetectionLatLng(det);
      if (!latlng) return;
      const label = normalizeLabel(det.issue_type || det.label || det.class_name);
      
      let dotColor = null;
      if (isDisease(label) && filterType === 'disease') dotColor = "#ef4444"; 
      if (isPest(label) && filterType === 'pest') dotColor = "#f97316";    

      if (dotColor) {
        L.circleMarker(latlng, { radius: 7, fillColor: dotColor, color: "#ffffff", weight: 1.5, fillOpacity: 0.95 }).addTo(dotLayer);
      }
    });

    dotLayer.addTo(exportMap);
    if (boundaryLayer && boundaryLayer.bringToFront) boundaryLayer.bringToFront();

    exportMap.invalidateSize(false);

    if (exportBounds && exportBounds.isValid()) {
      exportMap.fitBounds(exportBounds, { padding: [10, 10], maxZoom: 19, animate: false });
    } else {
      exportMap.setView(missionCenter, 18, { animate: false });
    }

    await wait(450);
    await waitForExportTiles(host, 3200);
    await wait(250);

    const canvas = await window.html2canvas(host, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    return cropCanvasCenter(canvas, 1.0); 

  } catch (err) {
    return await captureVisibleMapFallback();
  } finally {
    try { if (exportMap) exportMap.remove(); } catch {}
    try { if (host && host.parentNode) host.parentNode.removeChild(host); } catch {}
  }
}

// ---------------------------------------------------------
// CHART GENERATORS
// ---------------------------------------------------------
function buildPieSVG(cTungro, cBlb, cFungal, cHispa, cScald) {
  // Pastel colors exactly matching your screenshot requests
  const data = [
    { label: "Tungro", val: cTungro, color: "#ffe599" },            // Pastel Yellow
    { label: "Bacterial Leaf Blight", val: cBlb, color: "#c2e5b3" },// Pastel Green
    { label: "Fungal Spot", val: cFungal, color: "#f2d6f2" },       // Pastel Purple
    { label: "Leaf Scald", val: cScald, color: "#cce0ff" },         // Pastel Blue
    { label: "Rice Hispa", val: cHispa, color: "#d4f6f8" }          // Pastel Cyan
  ];
  
  let total = data.reduce((s, d) => s + d.val, 0) || 1;
  let svg = `<svg viewBox="-1 -1 2 2" style="width: 250px; height: 250px; transform: rotate(-90deg); overflow: visible;">`;
  let labelsHtml = '';
  let cumulativePercent = 0;
  
  data.forEach(slice => {
      if(slice.val === 0) return;
      const startP = cumulativePercent;
      cumulativePercent += slice.val / total;
      const endP = cumulativePercent;
      
      const startX = Math.cos(2 * Math.PI * startP);
      const startY = Math.sin(2 * Math.PI * startP);
      const endX = Math.cos(2 * Math.PI * endP);
      const endY = Math.sin(2 * Math.PI * endP);
      const largeArc = (endP - startP) > 0.5 ? 1 : 0;
      
      svg += `<path d="M 0 0 L ${startX} ${startY} A 1 1 0 ${largeArc} 1 ${endX} ${endY} Z" fill="${slice.color}" />`;

      const midP = startP + (slice.val / total) / 2;
      const lx = Math.cos(2 * Math.PI * (midP)); 
      const ly = Math.sin(2 * Math.PI * (midP));
      const left = 125 + (lx * 175); // Pushed labels further outside the pie chart
      const top = 125 + (ly * 175);
      
      labelsHtml += `<div style="position: absolute; left: ${left}px; top: ${top}px; transform: translate(-50%, -50%); text-align: center; font-size: 14px; line-height: 1.4; color: #000;">
          ${slice.label}<br>${slice.val}
      </div>`;
  });
  svg += `</svg>`;

  return `
    <div style="position: relative; width: 400px; height: 350px; display: flex; justify-content: center; align-items: center; margin-bottom: 20px;">
      ${svg}
      ${labelsHtml}
      <div style="position:absolute; bottom: -10px; left: 50%; transform: translateX(-50%); font-size: 16px; font-weight: bold;">In %</div>
    </div>
  `;
}

function buildBarChartSVG(diseaseIncidence, pestIncidence) {
  const maxVal = Math.max(40, Math.ceil(Math.max(diseaseIncidence, pestIncidence) / 10) * 10);
  const hD = (diseaseIncidence / maxVal) * 200; 
  const hP = (pestIncidence / maxVal) * 200;

  return `
  <div style="position: relative; width: 450px; height: 280px; margin: 0 auto; font-family: 'Inter', sans-serif;">
      
      <!-- Legends -->
      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 30px; padding-left: 100px; font-size: 14px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 12px; height: 12px; border-radius: 50%; background: #ff3b30;"></div>
          Overall Disease Field Severity
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 12px; height: 12px; border-radius: 50%; background: #fb923c;"></div>
          Overall Pest Field Severity
        </div>
      </div>

      <div style="position: relative; height: 200px;">
        <!-- Grid Lines & Y-Axis Labels -->
        <div style="position: absolute; bottom: 0; left: 30px; right: 0; height: 1px; background: #e5e7eb;"></div>
        <div style="position: absolute; bottom: 50px; left: 30px; right: 0; height: 1px; background: #e5e7eb;"></div>
        <div style="position: absolute; bottom: 100px; left: 30px; right: 0; height: 1px; background: #e5e7eb;"></div>
        <div style="position: absolute; bottom: 150px; left: 30px; right: 0; height: 1px; background: #e5e7eb;"></div>
        <div style="position: absolute; bottom: 200px; left: 30px; right: 0; height: 1px; background: #e5e7eb;"></div>
        
        <div style="position: absolute; bottom: -8px; left: 0; font-size: 14px; color: #000;">0</div>
        <div style="position: absolute; bottom: 42px; left: 0; font-size: 14px; color: #000;">${Math.round(maxVal * 0.25)}</div>
        <div style="position: absolute; bottom: 92px; left: 0; font-size: 14px; color: #000;">${Math.round(maxVal * 0.50)}</div>
        <div style="position: absolute; bottom: 142px; left: 0; font-size: 14px; color: #000;">${Math.round(maxVal * 0.75)}</div>
        <div style="position: absolute; bottom: 192px; left: 0; font-size: 14px; color: #000;">${Math.round(maxVal)}</div>
        
        <!-- Bars -->
        <div style="position: absolute; bottom: 1px; left: 70px; width: 140px; height: ${hD}px; background: #ff3b30; border-radius: 12px 12px 0 0; display: flex; justify-content: center; color: white; font-weight: normal; font-size: 14px; padding-top: 8px; box-sizing: border-box;">${diseaseIncidence.toFixed(0)}</div>
        <div style="position: absolute; bottom: 1px; left: 250px; width: 140px; height: ${hP}px; background: #fb923c; border-radius: 12px 12px 0 0; display: flex; justify-content: center; color: #000; font-weight: normal; font-size: 14px; padding-top: 8px; box-sizing: border-box;">${pestIncidence.toFixed(0)}</div>
      </div>

      <!-- Bottom Label -->
      <div style="position: absolute; bottom: -40px; width: 100%; text-align: center; font-size: 16px; padding-left: 30px; font-weight: bold;">In %</div>
  </div>
  `;
}

// ---------------------------------------------------------
// MULTI-PAGE EXPORT LOGIC
// ---------------------------------------------------------
export function initReportPDF({ btnId = "downloadPdfBtn" } = {}) {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const oldText = btn.textContent;

    try {
      btn.disabled = true;
      btn.textContent = "Generating...";
      showCenterNotif("Preparing multi-page report...", { showOk: false });
      document.body.classList.add("pdf-exporting");
      await wait(150);

      const mission = cachedMission || window.currentResultsMission || {};
      const missionCenter = getMissionCenterLatLng(mission);

      // Reverse geocode
      showCenterNotif("Verifying exact location...", { showOk: false });
      let finalPlaceName = null;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${missionCenter[0]}&lon=${missionCenter[1]}`);
        const data = await res.json();
        if (data && data.address) {
          const addr = data.address;
          const local = addr.village || addr.suburb || addr.neighbourhood || addr.hamlet || "";
          const city = addr.town || addr.city || addr.municipality || addr.county || "";
          finalPlaceName = [local, city].filter(Boolean).join(", ");
        }
      } catch(err) {}

      const place = finalPlaceName || getFieldValue(mission.field_location, mission.place, mission.mission_name, getText("fieldLocation"));
      
      showCenterNotif("Capturing maps...", { showOk: false });
      const diseaseMapShot = await captureExportMap('disease');
      const pestMapShot = await captureExportMap('pest');

      showCenterNotif("Calculating analytics...", { showOk: false });
      const areaHa = getFieldValue(mission.area_covered_ha, getText("metaArea"));
      const altitudeM = getFieldValue(mission.flight_altitude_m, getText("metaAltitude"));
      const generatedDate = todayISO();

      // Dynamic Math from Database
      let cTungro = 0, cBlb = 0, cFungal = 0, cHispa = 0, cScald = 0;
      cachedDetections.forEach(det => {
        const lbl = normalizeLabel(det.issue_type || det.label || det.class_name);
        if(lbl === 'Tungro') cTungro++;
        if(lbl === 'Bacterial_Leaf_Blight') cBlb++;
        if(lbl === 'Fungal_Spot') cFungal++;
        if(lbl === 'Rice_Hispa') cHispa++;
        if(lbl === 'Leaf_Scald') cScald++;
      });
      
      const diseaseCount = cTungro + cBlb + cFungal + cScald;
      const pestCount = cHispa;
      const totalImages = safeNum(mission.total_images) || Math.max(cachedDetections.length, 100);
      
      const diseaseIncidence = Math.min(100, (diseaseCount / totalImages) * 100);
      const pestIncidence = Math.min(100, (pestCount / totalImages) * 100);
      const overallIncidence = Math.min(100, ((diseaseCount + pestCount) / totalImages) * 100);
      
      let severityInterpretation = "low";
      if (overallIncidence > 50) severityInterpretation = "severe";
      else if (overallIncidence >= 31) severityInterpretation = "moderate";

      const primaryConcern = diseaseIncidence >= pestIncidence ? "diseases" : "pests";

      const pieSvgHtml = buildPieSVG(cTungro, cBlb, cFungal, cHispa, cScald);
      const barSvgHtml = buildBarChartSVG(diseaseIncidence, pestIncidence);
      const cScaldIncidence = ((cScald / totalImages) * 100).toFixed(0);

      const htmlContent = `
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          * { box-sizing: border-box; }
          .pdf-page { width: 800px; height: 1131px; background: #fff; color: #000; font-family: 'Inter', sans-serif; position: relative; overflow: hidden; }
          
          /* Page 1 Styles */
          .pdf-header-green { background: linear-gradient(to right, #6ee7b7, #a7f3d0, #6ee7b7); text-align: center; padding: 12px 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
          .pdf-details { margin: 20px 0 20px 100px; font-size: 15px; line-height: 2.0; font-weight: 500; }
          .pdf-details .row { display: flex; }
          .pdf-details .col1 { width: 180px; }
          
          .pdf-section { text-align: center; margin-bottom: 25px; }
          .pdf-section-title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
          
          /* Slimmed down map images so both fit easily on page 1 */
          .pdf-map-img { width: 480px; height: 215px; object-fit: cover; margin: 0 auto; display: block; border: 1px solid #ddd; }
          
          .pdf-sev-container { width: 480px; margin: 8px auto 0 auto; text-align: left; }
          .pdf-sev-title { font-size: 14px; font-weight: 500; margin-bottom: 6px; }
          .pdf-severity-bar-wrap { position: relative; width: 100%; margin-top: 25px; }
          
          /* Improved Severity Marker ensuring it points perfectly down */
          .pdf-severity-marker { position: absolute; top: -28px; width: 40px; margin-left: -20px; text-align: center; color: #000; z-index: 2; font-weight: 800; }
          .pdf-severity-marker span { display: block; font-size: 14px; line-height: 1; margin-bottom: 2px; }
          .pdf-severity-marker .arrow { font-size: 16px; line-height: 1; }
          
          .pdf-severity-bar { width: 100%; height: 30px; background: linear-gradient(to right, #fffbeb, #fcd34d, #f97316, #ef4444); border-radius: 2px; }
          .pdf-severity-labels { display: flex; justify-content: space-between; font-size: 11px; color: #6b7280; margin-top: 4px; font-weight: 500; }
          
          /* Subsequent Pages */
          .page-title { text-align: center; font-size: 22px; font-weight: 600; margin: 40px 0; }
          .section-heading { font-size: 18px; font-weight: 600; margin: 30px 40px 10px 40px; }
          
          .pdf-table { width: calc(100% - 80px); margin: 0 auto; border-collapse: collapse; font-size: 14px; }
          .pdf-table th, .pdf-table td { border: 1px solid #d1d5db; padding: 12px 14px; text-align: left; vertical-align: top; line-height: 1.6; }
          .pdf-table th { font-weight: bold; }
          .pdf-table ul { padding-left: 20px; margin: 0; }
          .pdf-table li { margin-bottom: 4px; }

          .p2-text-block { width: calc(100% - 80px); margin: 0 auto 40px; font-size: 15px; line-height: 1.6; text-align: justify; }
          
          /* Updated Page 2 box layout to pull Leaf Scald OUTSIDE */
          .p2-pie-side { 
              font-size: 15px; 
              line-height: 1.6; 
              background: #fff; 
              border-radius: 12px; 
              padding: 20px; 
              border: 1px solid #e5e7eb; 
              box-shadow: 0 4px 15px rgba(0,0,0,0.03); 
          }
        </style>

        <!-- PAGE 1 -->
        <div class="pdf-page">
          <div class="pdf-header-green">OryzAID MISSION REPORT</div>
          <div class="pdf-details">
              <div class="row"><div class="col1">Mission ID</div><div>${mission.mission_id || mission.id || "Unknown"}</div></div>
              <div class="row"><div class="col1">Place</div><div>${place}</div></div>
              <div class="row"><div class="col1">Coordinates</div><div>${missionCenter[0].toFixed(6)}, ${missionCenter[1].toFixed(6)}</div></div>
              <div class="row"><div class="col1">Area (ha)</div><div>${areaHa}</div></div>
              <div class="row"><div class="col1">Altitude (m)</div><div>${altitudeM}</div></div>
              <div class="row"><div class="col1">Generated</div><div>${generatedDate}</div></div>
          </div>
          
          <div class="pdf-section">
              <div class="pdf-section-title">Disease Map Overview</div>
              <img class="pdf-map-img" src="${diseaseMapShot.jpegData}" alt="Disease Map" />
              <div class="pdf-sev-container">
                  <div class="pdf-sev-title">Disease Field Severity</div>
                  <div class="pdf-severity-bar-wrap">
                      <div class="pdf-severity-marker" style="left: calc(${diseaseIncidence.toFixed(1)}% - 20px);">
                          <span>${diseaseIncidence.toFixed(0)}%</span>
                          <div class="arrow">▼</div>
                      </div>
                      <div class="pdf-severity-bar"></div>
                  </div>
                  <div class="pdf-severity-labels"><span>0%</span><span>50%</span><span>100%</span></div>
              </div>
          </div>
          
          <div class="pdf-section">
              <div class="pdf-section-title">Pest Map Overview</div>
              <img class="pdf-map-img" src="${pestMapShot.jpegData}" alt="Pest Map" />
              <div class="pdf-sev-container">
                  <div class="pdf-sev-title">Pest Field Severity</div>
                  <div class="pdf-severity-bar-wrap">
                      <div class="pdf-severity-marker" style="left: calc(${pestIncidence.toFixed(1)}% - 20px);">
                          <span>${pestIncidence.toFixed(0)}%</span>
                          <div class="arrow">▼</div>
                      </div>
                      <div class="pdf-severity-bar"></div>
                  </div>
                  <div class="pdf-severity-labels"><span>0%</span><span>50%</span><span>100%</span></div>
              </div>
          </div>
        </div>

        <!-- PAGE 2 -->
        <div class="pdf-page">
          <div class="page-title" style="margin-bottom: 20px;">DETECTION SUMMARY</div>
          
          <div style="display: flex; justify-content: center; align-items: center; gap: 40px; padding: 0 40px;">
            ${pieSvgHtml}
            <div style="display: flex; flex-direction: column; width: 340px;">
              <div class="p2-pie-side">
                The report shows an overall ${severityInterpretation} severity pattern based on a <span style="color: #dc2626; font-weight: bold;">${overallIncidence.toFixed(1)}%</span> field incidence rate, with ${primaryConcern} being the primary concern.
              </div>
              <div style="margin-top: 24px; font-size: 15px; color: #111827;">
                Leaf scald = ${cScaldIncidence}%
              </div>
            </div>
          </div>

          <div style="margin-top: 20px;">
            ${barSvgHtml}
          </div>

          <div class="p2-text-block" style="margin-top: 60px;">
            This report utilizes dual mapping techniques to present the finding. Disease detections are represented by red markers, while pest detections are indicated by orange markers. The level of severity is determined based on Disease Incidence, defined as the percentage of images containing identified threats, and is illustrated using the severity scale provided below. Furthermore, variations in color intensity correspond to the degree of severity, with stronger intensities indicating more severe conditions.
          </div>
        </div>

        <!-- PAGE 3 -->
        <div class="pdf-page">
          <div class="section-heading" style="margin-top: 60px;">Overall Disease Field Severity</div>
          <table class="pdf-table">
            <tr>
              <th style="width:25%;">Severity Level</th>
              <th style="width:25%;">Field Area Affected</th>
              <th style="width:50%;">Interpretation</th>
            </tr>
            <tr>
              <td>Low</td>
              <td>0–30%</td>
              <td>Minimal impact; crops remain mostly healthy</td>
            </tr>
            <tr>
              <td>Moderate</td>
              <td>31–50%</td>
              <td>Noticeable infection; partial yield reduction expected</td>
            </tr>
            <tr>
              <td>Severe</td>
              <td>51–100%</td>
              <td>Widespread damage; high yield loss likely</td>
            </tr>
          </table>

          <div class="section-heading" style="margin-top: 60px;">Overall Pest Severity</div>
          <table class="pdf-table">
            <tr>
              <th style="width:25%;">Severity Level</th>
              <th style="width:25%;">Field Area Affected</th>
              <th style="width:50%;">Interpretation</th>
            </tr>
            <tr>
              <td>Low</td>
              <td>0–30%</td>
              <td>Minimal pest damage; crops remain mostly healthy</td>
            </tr>
            <tr>
              <td>Moderate</td>
              <td>31–50%</td>
              <td>Noticeable pest damage; partial yield reduction</td>
            </tr>
            <tr>
              <td>Severe</td>
              <td>51–100%</td>
              <td>Widespread infestation; high yield loss expected</td>
            </tr>
          </table>
        </div>

        <!-- PAGE 4 -->
        <div class="pdf-page">
          <div class="page-title" style="margin-top: 60px;">PEST AND DISEASES AFFECTED AREA</div>
          
          <div class="section-heading">Bacterial Leaf Blight (BLB)</div>
          <table class="pdf-table">
            <tr>
              <th style="width:25%;">Severity Level</th>
              <th style="width:25%;">Field Area Affected</th>
              <th style="width:50%;">Interpretation</th>
            </tr>
            <tr>
              <td>Low</td>
              <td>0–30%</td>
              <td>
                <ul>
                  <li>Few plants show leaf blight symptoms</li>
                  <li>Lesions are small and scattered</li>
                </ul>
              </td>
            </tr>
            <tr>
              <td>Moderate</td>
              <td>31–50%</td>
              <td>
                <ul>
                  <li>Infection is noticeable in the affected area</li>
                </ul>
              </td>
            </tr>
            <tr>
              <td>Severe</td>
              <td>51–100%</td>
              <td>
                <ul>
                  <li>Majority of plants are affected</li>
                  <li>Extensive leaf drying and wilting observed</li>
                  <li>Significant yield loss is expected</li>
                </ul>
              </td>
            </tr>
          </table>

          <div class="section-heading" style="margin-top: 60px;">Rice Hispa (Insect Damage)</div>
          <table class="pdf-table">
            <tr>
              <th style="width:25%;">Severity Level</th>
              <th style="width:25%;">Field Area Affected</th>
              <th style="width:50%;">Interpretation</th>
            </tr>
            <tr>
              <td>Low</td>
              <td>0–30%</td>
              <td>
                <ul>
                  <li>Minor leaf scraping damage</li>
                  <li>Scattered feeding marks</li>
                </ul>
              </td>
            </tr>
            <tr>
              <td>Moderate</td>
              <td>31–50%</td>
              <td>
                <ul>
                  <li>Feeding damage is noticeable across the affected area</li>
                  <li>Leaves show visible scraping and discoloration</li>
                </ul>
              </td>
            </tr>
            <tr>
              <td>Severe</td>
              <td>51–100%</td>
              <td>
                <ul>
                  <li>Extensive leaf damage in the affected area</li>
                  <li>Severe impact on crop growth and yield</li>
                </ul>
              </td>
            </tr>
          </table>
        </div>

        <!-- PAGE 5 -->
        <div class="pdf-page">
          <div class="section-heading" style="margin-top: 60px;">Leaf Scald</div>
          <table class="pdf-table">
            <tr>
              <th style="width:25%;">Severity Level</th>
              <th style="width:25%;">Field Area Affected</th>
              <th style="width:50%;">Interpretation</th>
            </tr>
            <tr>
              <td>Low</td>
              <td>0–30%</td>
              <td>
                <ul>
                  <li>Few scald lesions observed</li>
                  <li>Symptoms are scattered and limited</li>
                  <li>Minimal impact on crop</li>
                </ul>
              </td>
            </tr>
            <tr>
              <td>Moderate</td>
              <td>31–50%</td>
              <td>
                <ul>
                  <li>Lesions are increasing and spreading</li>
                  <li>Noticeable damage across the affected area</li>
                  <li>Moderate reduction in plant health</li>
                </ul>
              </td>
            </tr>
            <tr>
              <td>Severe</td>
              <td>51–100%</td>
              <td>
                <ul>
                  <li>Large brown patches lesions dominate the affected area</li>
                  <li>Severe leaf damage is evident</li>
                  <li>High yield loss is expected</li>
                </ul>
              </td>
            </tr>
          </table>

          <div class="section-heading" style="margin-top: 60px;">Rice Tungro Disease</div>
          <table class="pdf-table">
            <tr>
              <th style="width:25%;">Severity Level</th>
              <th style="width:25%;">Field Area Affected</th>
              <th style="width:50%;">Interpretation</th>
            </tr>
            <tr>
              <td>Low</td>
              <td>0–30%</td>
              <td>
                <ul>
                  <li>Few infected plants observed</li>
                  <li>Mild yellowing of leaves</li>
                  <li>Limited spread of the disease</li>
                </ul>
              </td>
            </tr>
            <tr>
              <td>Moderate</td>
              <td>31–50%</td>
              <td>
                <ul>
                  <li>Infection is noticeable across the affected area</li>
                  <li>Yellow to yellow-orange discoloration visible</li>
                  <li>Some stunting of plants</li>
                </ul>
              </td>
            </tr>
            <tr>
              <td>Severe</td>
              <td>51–100%</td>
              <td>
                <ul>
                  <li>Widespread infection across the affected area</li>
                  <li>Strong discoloration</li>
                  <li>Severe yield loss is expected</li>
                </ul>
              </td>
            </tr>
          </table>
        </div>

        <!-- PAGE 6 -->
        <div class="pdf-page">
          <div class="section-heading" style="margin-top: 60px;">Fungal</div>
          <table class="pdf-table">
            <tr>
              <th style="width:25%;">Severity Level</th>
              <th style="width:25%;">Field Area Affected</th>
              <th style="width:50%;">Interpretation</th>
            </tr>
            <tr>
              <td>Low</td>
              <td>0–30%</td>
              <td>
                <ul>
                  <li>Scattered spots and lesions observed</li>
                  <li>Diseases are present but limited</li>
                  <li>Minimal effect on overall affected area</li>
                </ul>
              </td>
            </tr>
            <tr>
              <td>Moderate</td>
              <td>31–50%</td>
              <td>
                <ul>
                  <li>Mixed symptoms visible across the affected area</li>
                  <li>Lesions increasing in size and number</li>
                  <li>Moderate stress on plants</li>
                </ul>
              </td>
            </tr>
            <tr>
              <td>Severe</td>
              <td>51–100%</td>
              <td>
                <ul>
                  <li>Extensive and overlapping disease symptoms</li>
                  <li>Significant to severe yield loss expected</li>
                </ul>
              </td>
            </tr>
          </table>
          
          <div style="position: absolute; bottom: 40px; width: 100%; text-align: center; color: #6b7280; font-size: 14px; font-style: italic;">
            Generated by OryzAID Results Dashboard
          </div>
        </div>
      `;

      showCenterNotif("Compiling PDF pages...", { showOk: false });
      
      const wrapper = document.createElement("div");
      wrapper.style.position = "fixed";
      wrapper.style.left = "-9999px";
      wrapper.style.top = "0";
      wrapper.innerHTML = htmlContent;
      document.body.appendChild(wrapper);
      
      await wait(500); // Allow fonts to render

      const pages = wrapper.querySelectorAll('.pdf-page');
      const pdf = new window.jspdf.jsPDF("p", "pt", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage();
        showCenterNotif(`Rendering page ${i + 1} of 6...`, { showOk: false });
        
        const canvas = await window.html2canvas(pages[i], { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
        pdf.addImage(canvas.toDataURL("image/jpeg", 1.0), "JPEG", 0, 0, pdfWidth, pdfHeight);
      }

      document.body.removeChild(wrapper);

      showCenterNotif("Saving document...", { showOk: false });
      pdf.save(`${mission.mission_id || "oryzaid_report"}.pdf`);

      showCenterNotif("Report downloaded successfully!", { showOk: true, okText: "Done" });

    } catch (err) {
      console.error(err);
      showCenterNotif(`Export failed: ${err.message}`, { showOk: true });
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
      document.body.classList.remove("pdf-exporting");
    }
  });
}