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

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getFieldValue(...values) {
  for (const v of values) {
    const t = String(v || "").trim();
    if (t && t !== "—" && t !== "Unknown") return t;
  }
  return "—";
}

function cropCanvasCenter(sourceCanvas, cropRatio = 1.0) {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  if (!sw || !sh) throw new Error("Source canvas is empty");

  const cw = Math.max(1, Math.round(sw * cropRatio));
  const ch = Math.max(1, Math.round(sh * cropRatio));
  const sx = Math.round((sw - cw) / 2);
  const sy = Math.round((sh - ch) / 2);

  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  const ctx = out.getContext("2d");
  ctx.drawImage(sourceCanvas, sx, sy, cw, ch, 0, 0, cw, ch);

  return { canvas: out, jpegData: out.toDataURL("image/jpeg", 0.95) };
}

function hideLiveMapUIForCapture() {
  const selectors = [".leaflet-control-zoom", ".maizeeye-legend", ".leaflet-control-attribution", ".leaflet-popup", ".layer-status-bar"];
  const changed = [];
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      changed.push([el, el.style.visibility]);
      el.style.visibility = "hidden";
    });
  });
  return () => changed.forEach(([el, prev]) => { el.style.visibility = prev; });
}

async function waitForExportTiles(mapEl, timeoutMs = 3200) {
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

function getMissionCenterLatLng(mission) {
  const lat = safeNum(mission?.center_lat ?? mission?.lat ?? mission?.latitude, 17.6132);
  const lng = safeNum(mission?.center_lng ?? mission?.lng ?? mission?.longitude, 121.7269);
  return [lat, lng];
}

function getBoundaryLatLngs(mission) {
  const raw = mission?.field_boundary || mission?.polygon || mission?.boundary_points || mission?.drawn_polygon || mission?.field_polygon || [];
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

// Plots the dots exactly where they are cached.
async function captureExportMap(filterType, renderPoly = null, filterPoly = null) {
  const mission = cachedMission || window.currentResultsMission || null;
  const detectionsToUse = Array.isArray(cachedDetections) ? [...cachedDetections] : [];

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

    exportMap = L.map(host, { zoomControl: false, attributionControl: false, maxZoom: 22, preferCanvas: true });

    L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
      maxZoom: 22, maxNativeZoom: 19, crossOrigin: true
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

    if (renderPoly && window.L && window.L.geoJSON) {
        L.geoJSON(renderPoly, {
            style: { color: "#3b82f6", weight: 3, fillColor: "#3b82f6", fillOpacity: 0.15 }
        }).addTo(exportMap);
    }

    const dotLayer = L.layerGroup();
    const usePoly = filterPoly || renderPoly;

    detectionsToUse.forEach((det) => {
      let latlng = getDetectionLatLng(det);
      if (!latlng) return;

      if (usePoly && window.turf) {
         const pt = window.turf.point([latlng[1], latlng[0]]);
         if (!window.turf.booleanPointInPolygon(pt, usePoly)) {
            return; 
         }
      }

      const label = normalizeLabel(det.issue_type || det.label || det.class_name);
      
      let dotColor = null;
      if (isDisease(label) && filterType === 'disease') dotColor = "#ef4444"; 
      if (isPest(label) && filterType === 'pest') dotColor = "#f97316";    

      if (dotColor) {
        L.circleMarker(latlng, { radius: 5.0, fillColor: dotColor, color: "#ffffff", weight: 1.5, fillOpacity: 0.95 }).addTo(dotLayer);
      }
    });

    dotLayer.addTo(exportMap);
    if (boundaryLayer && boundaryLayer.bringToFront) boundaryLayer.bringToFront();

    exportMap.invalidateSize(false);

    if (exportBounds && exportBounds.isValid()) {
      exportMap.fitBounds(exportBounds, { padding: [50, 50], maxZoom: 22, animate: false });
    } else {
      exportMap.setView(missionCenter, 19, { animate: false });
    }

    await wait(450);
    await waitForExportTiles(host, 3200);
    await wait(250);

    const canvas = await window.html2canvas(host, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    return cropCanvasCenter(canvas, 1.0); 

  } catch (err) {
    console.error(err);
    return null;
  } finally {
    try { if (exportMap) exportMap.remove(); } catch {}
    try { if (host && host.parentNode) host.parentNode.removeChild(host); } catch {}
  }
}

// ---------------------------------------------------------
// CHART GENERATORS (Styled directly to match reference image)
// ---------------------------------------------------------
function buildPieSVG(cTungro, cBlb, cFungal, cHispa, cScald) {
  const data = [
    { label: "Tungro", val: cTungro, color: "#fde68a" },
    { label: "Bacterial Leaf Blight", val: cBlb, color: "#bbf7d0" },
    { label: "Fungal Spot", val: cFungal, color: "#e9d5ff" },
    { label: "Leaf Scald", val: cScald, color: "#bfdbfe" },
    { label: "Rice Hispa", val: cHispa, color: "#cffafe" }
  ];
  
  let total = data.reduce((s, d) => s + d.val, 0) || 1;
  let svg = `<svg viewBox="-1 -1 2 2" style="width: 200px; height: 200px; transform: rotate(-90deg); overflow: visible;">`;
  
  let cumulativePercent = 0;
  
  data.forEach(slice => {
      if(slice.val === 0) return;
      const startP = cumulativePercent;
      const slicePct = slice.val / total;
      cumulativePercent += slicePct;
      const endP = cumulativePercent;
      
      const startX = Math.cos(2 * Math.PI * startP);
      const startY = Math.sin(2 * Math.PI * startP);
      const endX = Math.cos(2 * Math.PI * endP);
      const endY = Math.sin(2 * Math.PI * endP);
      const largeArc = (endP - startP) > 0.5 ? 1 : 0;
      
      if (slicePct === 1) {
        svg += `<circle cx="0" cy="0" r="1" fill="${slice.color}" />`;
      } else {
        svg += `<path d="M 0 0 L ${startX} ${startY} A 1 1 0 ${largeArc} 1 ${endX} ${endY} Z" fill="${slice.color}" />`;
      }
  });
  svg += `</svg>`;

  let legendHtml = `<div style="display: flex; flex-direction: column; gap: 6px; margin-top: 15px; width: 100%; align-items: flex-start; padding-left: 20px;">`;
  data.forEach(slice => {
      if(slice.val === 0) return;
      const slicePct = slice.val / total;
      legendHtml += `
        <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: #111827; font-weight: 600;">
          <div style="width: 12px; height: 12px; background-color: ${slice.color}; border-radius: 2px;"></div>
          <span>${slice.label}: ${slice.val} img (${(slicePct * 100).toFixed(1)}%)</span>
        </div>
      `;
  });
  legendHtml += `</div>`;

  return `
    <div style="display: flex; flex-direction: column; align-items: center; width: 280px;">
      <div style="position: relative; width: 200px; height: 200px; display: flex; justify-content: center; align-items: center;">
        ${svg}
      </div>
      <div style="margin-top: 20px; font-size: 13px; font-weight: 800; color: #111827;">In %</div>
      ${legendHtml}
    </div>
  `;
}

function buildBarChartSVG(diseaseIncidence, pestIncidence, prefix) {
  const maxValRaw = Math.max(diseaseIncidence, pestIncidence);
  const maxVal = Math.max(40, Math.ceil(maxValRaw / 10) * 10);
  const hD = (diseaseIncidence / maxVal) * 150; 
  const hP = (pestIncidence / maxVal) * 150;

  const renderBar = (val, h, color, left) => {
    const isShort = h < 20;
    const textBottom = isShort ? -20 : h - 20;
    const tColor = isShort ? '#111827' : '#ffffff';
    return `
      <div style="position: absolute; bottom: 0; left: ${left}px; width: 110px; height: ${Math.max(h, 2)}px; background: ${color}; border-radius: 8px 8px 0 0;"></div>
      <div style="position: absolute; bottom: ${textBottom}px; left: ${left}px; width: 110px; text-align: center; color: ${tColor}; font-size: 11px; font-weight: 600;">${val.toFixed(1)}</div>
    `;
  };

  return `
  <div style="width: 400px; margin: 0 auto; font-family: 'Inter', sans-serif;">
      <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-bottom: 30px; margin-left: 100px; font-size: 11px; font-weight: 600; color: #111827;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <div style="width: 10px; height: 10px; border-radius: 50%; background: #ef4444;"></div>
          ${prefix} Disease Field Severity
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <div style="width: 10px; height: 10px; border-radius: 50%; background: #f97316;"></div>
          ${prefix} Pest Field Severity
        </div>
      </div>

      <div style="position: relative; height: 150px; margin-left: 60px; margin-bottom: 25px; width: 300px;">
        <!-- Grid lines -->
        <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 1px; background: #e5e7eb;"></div>
        <div style="position: absolute; bottom: 37.5px; left: 0; right: 0; height: 1px; background: #f3f4f6;"></div>
        <div style="position: absolute; bottom: 75px; left: 0; right: 0; height: 1px; background: #f3f4f6;"></div>
        <div style="position: absolute; bottom: 112.5px; left: 0; right: 0; height: 1px; background: #f3f4f6;"></div>
        <div style="position: absolute; bottom: 150px; left: 0; right: 0; height: 1px; background: #f3f4f6;"></div>
        
        <!-- Y-Axis Labels -->
        <div style="position: absolute; bottom: -6px; left: -30px; font-size: 11px; color: #111827; width: 20px; text-align: right;">0</div>
        <div style="position: absolute; bottom: 31.5px; left: -30px; font-size: 11px; color: #111827; width: 20px; text-align: right;">${Math.round(maxVal * 0.25)}</div>
        <div style="position: absolute; bottom: 69px; left: -30px; font-size: 11px; color: #111827; width: 20px; text-align: right;">${Math.round(maxVal * 0.50)}</div>
        <div style="position: absolute; bottom: 106.5px; left: -30px; font-size: 11px; color: #111827; width: 20px; text-align: right;">${Math.round(maxVal * 0.75)}</div>
        <div style="position: absolute; bottom: 144px; left: -30px; font-size: 11px; color: #111827; width: 20px; text-align: right;">${Math.round(maxVal)}</div>
        
        <!-- Bars -->
        ${renderBar(diseaseIncidence, hD, '#ef4444', 30)}
        ${renderBar(pestIncidence, hP, '#f97316', 160)}
      </div>
      <div style="text-align: center; font-size: 13px; font-weight: 800; color: #111827;">In %</div>
  </div>
  `;
}

// Generates the clean Detection Summary Page (used for both Overall and specific Areas)
function buildDetectionSummaryPageHtml(title, diseaseInc, pestInc, overallInc, interpretation, concern, pieCounts, prefix) {
  const pieSvgHtml = buildPieSVG(pieCounts.tungro, pieCounts.blb, pieCounts.fungal, pieCounts.hispa, pieCounts.scald);
  const barSvgHtml = buildBarChartSVG(diseaseInc, pestInc, prefix);

  const targetLabel = prefix === 'Overall' ? 'report' : 'segment';
  const incidenceLabel = prefix === 'Overall' ? 'field' : 'local';

  return `
    <!-- DETECTION SUMMARY PAGE -->
    <div class="pdf-page" style="position: relative; background: #fff;">
      <div class="page-title" style="text-align: center; margin-top: 50px; margin-bottom: 40px; font-family: 'Inter', sans-serif; font-size: 20px; font-weight: 800; color: #111827; text-transform: uppercase;">
        ${title}
      </div>
      <div style="display: flex; justify-content: center; align-items: flex-start; gap: 40px; padding: 0 40px;">
        ${pieSvgHtml}
        <div style="display: flex; flex-direction: column; width: 340px; margin-top: 15px;">
          <div style="font-size: 13px; line-height: 1.6; background: #fff; border-radius: 8px; padding: 20px; border: 1px solid #e5e7eb; box-shadow: 0 4px 15px rgba(0,0,0,0.03); color: #111827; font-weight: 500;">
            The ${targetLabel} shows an overall ${interpretation} severity pattern based on a <span style="color: #dc2626; font-weight: 800;">${overallInc.toFixed(1)}%</span> ${incidenceLabel} incidence rate, with ${concern} being the primary concern.
          </div>
        </div>
      </div>
      <div style="margin-top: 30px;">${barSvgHtml}</div>
      <div class="pdf-footer" style="position: absolute; bottom: 30px; width: 100%; text-align: center; color: #9ca3af; font-size: 11px; font-style: italic;">Generated by OryzAID Results Dashboard</div>
    </div>
  `;
}

function buildSingleAreaPageHtml(title, inc, type, mapShot) {
  const color = type === 'Disease' ? '#ef4444' : '#f97316';
  
  return `
  <!-- DYNAMIC AREA SEGMENT PAGE -->
  <div class="pdf-page" style="position: relative; background: #fff;">
    
    <!-- Minimalist Logo -->
    <div style="position: absolute; top: 40px; left: 40px; font-family: 'Outfit', sans-serif; font-size: 20px; font-weight: 500; color: #111827; letter-spacing: -0.5px;">
      OryzAID
    </div>
    
    <!-- Title -->
    <div style="text-align: center; margin-top: 80px; margin-bottom: 30px; font-family: 'Inter', sans-serif; font-size: 20px; font-weight: 800; color: #111827; text-transform: uppercase;">
      ${title}
    </div>
    
    <!-- Map Image -->
    <div style="text-align: center; margin-bottom: 40px;">
      <img src="${mapShot?.jpegData || ''}" alt="${type} Segment Map" style="width: 540px; height: 360px; object-fit: cover; border-radius: 12px; box-shadow: 0 8px 20px rgba(0,0,0,0.08);" />
    </div>
    
    <!-- Severity Section -->
    <div style="width: 540px; margin: 0 auto;">
        <div style="display: flex; justify-content: space-between; align-items: flex-end; font-family: 'Inter', sans-serif; font-weight: 800; font-size: 14px; margin-bottom: 40px; color: #111827;">
           <span>LOCAL SEVERITY INCIDENCE</span>
           <span style="color: ${color}; font-size: 16px;">${inc.toFixed(1)}%</span>
        </div>
        
        <div style="position: relative; width: 100%;">
            <!-- Marker -->
            <div style="position: absolute; top: -28px; left: ${inc.toFixed(1)}%; transform: translateX(-50%); text-align: center; color: #111827; font-weight: 800; font-size: 13px; line-height: 1.2;">
                <span>${inc.toFixed(1)}%</span>
                <div style="font-size: 14px; margin-top: 1px;">▼</div>
            </div>
            
            <!-- Bar -->
            <div style="width: 100%; height: 18px; background: linear-gradient(to right, #fef3c7, #fcd34d, #f97316, #ef4444); border-radius: 4px;"></div>
        </div>
        
        <!-- Axis Labels -->
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: #6b7280; font-weight: 600; margin-top: 8px;">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
        </div>
    </div>
    
    <!-- Footer -->
    <div style="position: absolute; bottom: 40px; width: 100%; text-align: center; color: #9ca3af; font-size: 11px; font-style: italic;">
      Generated by OryzAID Results Dashboard
    </div>
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

      let place = getFieldValue(mission.field_location, mission.place, mission.mission_name, getText("metaPlace"));

      if (!place || place === "—" || place === "Unknown") {
        showCenterNotif("Verifying exact location...", { showOk: false });
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${missionCenter[0]}&lon=${missionCenter[1]}`);
          const data = await res.json();
          if (data && data.address) {
            const addr = data.address;
            const local = addr.village || addr.suburb || addr.neighbourhood || addr.hamlet || "";
            const city = addr.town || addr.city || addr.municipality || addr.county || "";
            place = [local, city].filter(Boolean).join(", ") || place;
          }
        } catch(err) {}
      }
      
      showCenterNotif("Capturing overall field maps...", { showOk: false });
      const diseaseMapShot = await captureExportMap('disease');
      const pestMapShot = await captureExportMap('pest');

      showCenterNotif("Calculating analytics...", { showOk: false });
      const areaHa = getFieldValue(mission.area_covered_ha, getText("metaArea"));
      const altitudeM = getFieldValue(mission.flight_altitude_m, getText("metaAltitude"));
      const generatedDate = todayISO();

      // SCIENTIFIC INCIDENCE MATH (OVERALL)
      const cTungro = new Set();
      const cBlb = new Set();
      const cFungal = new Set();
      const cHispa = new Set();
      const cScald = new Set();

      const diseaseImages = new Set();
      const pestImages = new Set();

      cachedDetections.forEach(det => {
        const lbl = normalizeLabel(det.issue_type || det.label || det.class_name);
        const imgId = det.image_url || `${det.latitude}_${det.longitude}`;

        if(lbl === 'Tungro') { cTungro.add(imgId); diseaseImages.add(imgId); }
        if(lbl === 'Bacterial_Leaf_Blight') { cBlb.add(imgId); diseaseImages.add(imgId); }
        if(lbl === 'Fungal_Spot') { cFungal.add(imgId); diseaseImages.add(imgId); }
        if(lbl === 'Rice_Hispa') { cHispa.add(imgId); pestImages.add(imgId); }
        if(lbl === 'Leaf_Scald') { cScald.add(imgId); diseaseImages.add(imgId); }
      });
      
      const totalImages = safeNum(mission.total_images) || Math.max(cachedDetections.length, 100);
      
      const diseaseIncidence = Math.min(100, (diseaseImages.size / totalImages) * 100);
      const pestIncidence = Math.min(100, (pestImages.size / totalImages) * 100);
      
      const allInfectedImages = new Set([...diseaseImages, ...pestImages]);
      const overallIncidence = Math.min(100, (allInfectedImages.size / totalImages) * 100);
      
      let severityInterpretation = "low";
      if (overallIncidence > 50) severityInterpretation = "severe";
      else if (overallIncidence >= 31) severityInterpretation = "moderate";

      const primaryConcern = diseaseIncidence >= pestIncidence ? "diseases" : "pests";

      const overallSummaryHtml = buildDetectionSummaryPageHtml(
        "DETECTION SUMMARY",
        diseaseIncidence, pestIncidence, overallIncidence, severityInterpretation, primaryConcern,
        { tungro: cTungro.size, blb: cBlb.size, fungal: cFungal.size, hispa: cHispa.size, scald: cScald.size },
        "Overall"
      );

      // ==========================================
      // SEGMENTED AREA DYNAMIC GENERATOR
      // Calculates accurate counts for Pie Chart per area!
      // ==========================================
      const areaData = [];
      const totalAreaImages = Math.ceil(totalImages / 5) || 1;
      
      const boundaryLatLngs = getBoundaryLatLngs(mission);
      if (boundaryLatLngs.length >= 3 && window.turf) {
        const ring = boundaryLatLngs.map(p => [p[1], p[0]]);
        if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) {
            ring.push([...ring[0]]);
        }
        const fieldPoly = window.turf.polygon([ring]);
        const bbox = window.turf.bbox(fieldPoly);
        const north = bbox[3];
        const south = bbox[1];
        
        const east = bbox[2] + 0.01;
        const west = bbox[0] - 0.01;
        const latStep = (north - south) / 5;

        for (let i = 0; i < 5; i++) {
            const stripNorth = north - (latStep * i);
            const stripSouth = stripNorth - latStep;
            const stripCoords = [
              [ [west, stripSouth], [east, stripSouth], [east, stripNorth], [west, stripNorth], [west, stripSouth] ]
            ];
            
            const filterPoly = window.turf.polygon(stripCoords);
            const renderPoly = window.turf.intersect(fieldPoly, filterPoly); 
            
            const areaDiseaseImages = new Set();
            const areaPestImages = new Set();
            const areaC_Tungro = new Set();
            const areaC_Blb = new Set();
            const areaC_Fungal = new Set();
            const areaC_Hispa = new Set();
            const areaC_Scald = new Set();
            
            cachedDetections.forEach(det => {
              let latlng = getDetectionLatLng(det);
              if (latlng) {
                const pt = window.turf.point([latlng[1], latlng[0]]);
                if (window.turf.booleanPointInPolygon(pt, filterPoly)) {
                  const lbl = normalizeLabel(det.issue_type || det.label || det.class_name);
                  const imgId = det.image_url || `${latlng[0]}_${latlng[1]}`;
                  if (isDisease(lbl)) areaDiseaseImages.add(imgId);
                  if (isPest(lbl)) areaPestImages.add(imgId);

                  if(lbl === 'Tungro') areaC_Tungro.add(imgId);
                  if(lbl === 'Bacterial_Leaf_Blight') areaC_Blb.add(imgId);
                  if(lbl === 'Fungal_Spot') areaC_Fungal.add(imgId);
                  if(lbl === 'Rice_Hispa') areaC_Hispa.add(imgId);
                  if(lbl === 'Leaf_Scald') areaC_Scald.add(imgId);
                }
              }
            });

            const areaAllInfected = new Set([...areaDiseaseImages, ...areaPestImages]);
            const areaOverallIncidence = Math.min(100, (areaAllInfected.size / totalAreaImages) * 100);
            
            let areaInterp = "low";
            if (areaOverallIncidence > 50) areaInterp = "severe";
            else if (areaOverallIncidence >= 31) areaInterp = "moderate";

            const areaConcern = areaDiseaseImages.size >= areaPestImages.size ? "diseases" : "pests";
            
            areaData.push({
                name: `Area ${i+1} (${['First', 'Second', 'Third', 'Fourth', 'Fifth'][i]} Leg)`,
                diseaseInc: Math.min(100, (areaDiseaseImages.size / totalAreaImages) * 100),
                pestInc: Math.min(100, (areaPestImages.size / totalAreaImages) * 100),
                overallInc: areaOverallIncidence,
                interpretation: areaInterp,
                concern: areaConcern,
                renderPoly: renderPoly,
                filterPoly: filterPoly,
                counts: {
                    tungro: areaC_Tungro.size,
                    blb: areaC_Blb.size,
                    fungal: areaC_Fungal.size,
                    hispa: areaC_Hispa.size,
                    scald: areaC_Scald.size
                }
            });
        }
      }

      // Generate the custom Area Sets (Map + Summary Page for each active area)
      let dynamicAreaPagesHtml = '';
      for (let area of areaData) {
          let hasContent = false;
          if (area.diseaseInc > 0) {
              showCenterNotif(`Capturing Disease Highlight Map for ${area.name}...`, { showOk: false });
              const areaShot = await captureExportMap('disease', area.renderPoly, area.filterPoly);
              dynamicAreaPagesHtml += buildSingleAreaPageHtml(`DISEASE SEGMENT: ${area.name.toUpperCase()}`, area.diseaseInc, 'Disease', areaShot);
              hasContent = true;
          }
          if (area.pestInc > 0) {
              showCenterNotif(`Capturing Pest Highlight Map for ${area.name}...`, { showOk: false });
              const areaShot = await captureExportMap('pest', area.renderPoly, area.filterPoly);
              dynamicAreaPagesHtml += buildSingleAreaPageHtml(`PEST SEGMENT: ${area.name.toUpperCase()}`, area.pestInc, 'Pest', areaShot);
              hasContent = true;
          }
          if (hasContent) {
              // Now seamlessly inject a Summary page specific to this Area
              dynamicAreaPagesHtml += buildDetectionSummaryPageHtml(
                `${area.name.toUpperCase()} DETECTION SUMMARY`,
                area.diseaseInc, area.pestInc, area.overallInc, area.interpretation, area.concern,
                area.counts,
                "Local"
              );
          }
      }

      const htmlContent = `
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          * { box-sizing: border-box; }
          .pdf-page { width: 800px; height: 1131px; background: #fff; color: #000; font-family: 'Inter', sans-serif; position: relative; overflow: hidden; }
          
          /* Page 1 Details */
          .pdf-header-green { background: linear-gradient(to right, #6ee7b7, #a7f3d0, #6ee7b7); text-align: center; padding: 10px 0; font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }
          .pdf-details { margin: 15px 0 15px 100px; font-size: 14px; line-height: 1.8; font-weight: 500; }
          .pdf-details .row { display: flex; }
          .pdf-details .col1 { width: 180px; }
          
          /* Page 1 Maps - Space Saving Layout */
          .pdf-section { text-align: center; margin-bottom: 15px; }
          .pdf-section-title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
          .pdf-map-img { width: 400px; height: 300px; object-fit: cover; margin: 0 auto; display: block; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
          .pdf-sev-container { width: 400px; margin: 8px auto 0 auto; text-align: left; }
          .pdf-sev-title { font-size: 14px; font-weight: 500; margin-bottom: 6px; }
          
          .pdf-severity-bar-wrap { position: relative; width: 100%; margin-top: 35px; }
          .pdf-severity-marker { position: absolute; top: -28px; width: 40px; margin-left: -20px; text-align: center; color: #000; z-index: 2; font-weight: 800; }
          .pdf-severity-marker span { display: block; font-size: 14px; line-height: 1; margin-bottom: 2px; }
          .pdf-severity-marker .arrow { font-size: 16px; line-height: 1; }
          .pdf-severity-bar { width: 100%; height: 30px; background: linear-gradient(to right, #fffbeb, #fcd34d, #f97316, #ef4444); border-radius: 2px; }
          .pdf-severity-labels { display: flex; justify-content: space-between; font-size: 11px; color: #6b7280; margin-top: 4px; font-weight: 500; }
          
          /* Other Pages */
          .page-title { text-align: center; font-size: 22px; font-weight: 600; margin: 40px 0; }
          .section-heading { font-size: 18px; font-weight: 600; margin: 30px 40px 10px 40px; }
          .pdf-table { width: calc(100% - 80px); margin: 0 auto; border-collapse: collapse; font-size: 14px; }
          .pdf-table th, .pdf-table td { border: 1px solid #d1d5db; padding: 12px 14px; text-align: left; vertical-align: top; line-height: 1.6; }
          .pdf-table th { font-weight: bold; }
          .pdf-table ul { padding-left: 20px; margin: 0; }
          .pdf-table li { margin-bottom: 4px; }
        </style>

        <!-- PAGE 1 (Overview) -->
        <div class="pdf-page">
          <div class="pdf-header-green">OryzAID MISSION REPORT</div>
          <div class="pdf-details">
              <div class="row"><div class="col1">Mission ID</div><div>${mission.mission_id || mission.id || "Unknown"}</div></div>
              <div class="row"><div class="col1">Place</div><div>${place}</div></div>
              <div class="row"><div class="col1">Coordinates</div><div>${missionCenter[0].toFixed(6)}, ${missionCenter[1].toFixed(6)}</div></div>
              <div class="row"><div class="col1">Area</div><div>${areaHa}</div></div>
              <div class="row"><div class="col1">Altitude (m)</div><div>${altitudeM}</div></div>
              <div class="row"><div class="col1">Generated</div><div>${generatedDate}</div></div>
          </div>
          <div class="pdf-section">
              <div class="pdf-section-title">Disease Map Overview</div>
              <img class="pdf-map-img" src="${diseaseMapShot?.jpegData || ''}" alt="Disease Map" />
              <div class="pdf-sev-container">
                  <div class="pdf-sev-title">Disease Field Severity</div>
                  <div class="pdf-severity-bar-wrap">
                      <div class="pdf-severity-marker" style="left: ${diseaseIncidence.toFixed(1)}%;">
                          <span>${diseaseIncidence.toFixed(1)}%</span><div class="arrow">▼</div>
                      </div>
                      <div class="pdf-severity-bar"></div>
                  </div>
                  <div class="pdf-severity-labels"><span>0%</span><span>50%</span><span>100%</span></div>
              </div>
          </div>
          <div class="pdf-section">
              <div class="pdf-section-title">Pest Map Overview</div>
              <img class="pdf-map-img" src="${pestMapShot?.jpegData || ''}" alt="Pest Map" />
              <div class="pdf-sev-container">
                  <div class="pdf-sev-title">Pest Field Severity</div>
                  <div class="pdf-severity-bar-wrap">
                      <div class="pdf-severity-marker" style="left: ${pestIncidence.toFixed(1)}%;">
                          <span>${pestIncidence.toFixed(1)}%</span><div class="arrow">▼</div>
                      </div>
                      <div class="pdf-severity-bar"></div>
                  </div>
                  <div class="pdf-severity-labels"><span>0%</span><span>50%</span><span>100%</span></div>
              </div>
          </div>
        </div>

        ${overallSummaryHtml}

        ${dynamicAreaPagesHtml}

        <!-- SEVERITY SCALES -->
        <div class="pdf-page">
          <div class="section-heading" style="margin-top: 60px;">Overall Disease Field Severity</div>
          <table class="pdf-table">
            <tr><th style="width:25%;">Severity Level</th><th style="width:25%;">Field Area Affected</th><th style="width:50%;">Interpretation</th></tr>
            <tr><td>Low</td><td>0–30%</td><td>Minimal impact; crops remain mostly healthy</td></tr>
            <tr><td>Moderate</td><td>31–50%</td><td>Noticeable infection; partial yield reduction expected</td></tr>
            <tr><td>Severe</td><td>51–100%</td><td>Widespread damage; high yield loss likely</td></tr>
          </table>
          <div class="section-heading" style="margin-top: 60px;">Overall Pest Severity</div>
          <table class="pdf-table">
            <tr><th style="width:25%;">Severity Level</th><th style="width:25%;">Field Area Affected</th><th style="width:50%;">Interpretation</th></tr>
            <tr><td>Low</td><td>0–30%</td><td>Minimal pest damage; crops remain mostly healthy</td></tr>
            <tr><td>Moderate</td><td>31–50%</td><td>Noticeable pest damage; partial yield reduction</td></tr>
            <tr><td>Severe</td><td>51–100%</td><td>Widespread infestation; high yield loss expected</td></tr>
          </table>
        </div>

        <!-- DETAILS PAGE 1 -->
        <div class="pdf-page">
          <div class="page-title" style="margin-top: 60px;">PEST AND DISEASES AFFECTED AREA</div>
          <div class="section-heading">Bacterial Leaf Blight (BLB)</div>
          <table class="pdf-table">
            <tr><th style="width:25%;">Severity Level</th><th style="width:25%;">Field Area Affected</th><th style="width:50%;">Interpretation</th></tr>
            <tr><td>Low</td><td>0–30%</td><td><ul><li>Few plants show leaf blight symptoms</li><li>Lesions are small and scattered</li></ul></td></tr>
            <tr><td>Moderate</td><td>31–50%</td><td><ul><li>Infection is noticeable in the affected area</li></ul></td></tr>
            <tr><td>Severe</td><td>51–100%</td><td><ul><li>Majority of plants are affected</li><li>Extensive leaf drying and wilting observed</li><li>Significant yield loss is expected</li></ul></td></tr>
          </table>
          <div class="section-heading" style="margin-top: 60px;">Rice Hispa (Insect Damage)</div>
          <table class="pdf-table">
            <tr><th style="width:25%;">Severity Level</th><th style="width:25%;">Field Area Affected</th><th style="width:50%;">Interpretation</th></tr>
            <tr><td>Low</td><td>0–30%</td><td><ul><li>Minor leaf scraping damage</li><li>Scattered feeding marks</li></ul></td></tr>
            <tr><td>Moderate</td><td>31–50%</td><td><ul><li>Feeding damage is noticeable across the affected area</li><li>Leaves show visible scraping and discoloration</li></ul></td></tr>
            <tr><td>Severe</td><td>51–100%</td><td><ul><li>Extensive leaf damage in the affected area</li><li>Severe impact on crop growth and yield</li></ul></td></tr>
          </table>
        </div>

        <!-- DETAILS PAGE 2 -->
        <div class="pdf-page">
          <div class="section-heading" style="margin-top: 60px;">Leaf Scald</div>
          <table class="pdf-table">
            <tr><th style="width:25%;">Severity Level</th><th style="width:25%;">Field Area Affected</th><th style="width:50%;">Interpretation</th></tr>
            <tr><td>Low</td><td>0–30%</td><td><ul><li>Few scald lesions observed</li><li>Symptoms are scattered and limited</li><li>Minimal impact on crop</li></ul></td></tr>
            <tr><td>Moderate</td><td>31–50%</td><td><ul><li>Lesions are increasing and spreading</li><li>Noticeable damage across the affected area</li><li>Moderate reduction in plant health</li></ul></td></tr>
            <tr><td>Severe</td><td>51–100%</td><td><ul><li>Large brown patches lesions dominate the affected area</li><li>Severe leaf damage is evident</li><li>High yield loss is expected</li></ul></td></tr>
          </table>
          <div class="section-heading" style="margin-top: 60px;">Rice Tungro Disease</div>
          <table class="pdf-table">
            <tr><th style="width:25%;">Severity Level</th><th style="width:25%;">Field Area Affected</th><th style="width:50%;">Interpretation</th></tr>
            <tr><td>Low</td><td>0–30%</td><td><ul><li>Few infected plants observed</li><li>Mild yellowing of leaves</li><li>Limited spread of the disease</li></ul></td></tr>
            <tr><td>Moderate</td><td>31–50%</td><td><ul><li>Infection is noticeable across the affected area</li><li>Yellow to yellow-orange discoloration visible</li><li>Some stunting of plants</li></ul></td></tr>
            <tr><td>Severe</td><td>51–100%</td><td><ul><li>Widespread infection across the affected area</li><li>Strong discoloration</li><li>Severe yield loss is expected</li></ul></td></tr>
          </table>
        </div>

        <!-- DETAILS PAGE 3 -->
        <div class="pdf-page">
          <div class="section-heading" style="margin-top: 60px;">Fungal</div>
          <table class="pdf-table">
            <tr><th style="width:25%;">Severity Level</th><th style="width:25%;">Field Area Affected</th><th style="width:50%;">Interpretation</th></tr>
            <tr><td>Low</td><td>0–30%</td><td><ul><li>Scattered spots and lesions observed</li><li>Diseases are present but limited</li><li>Minimal effect on overall affected area</li></ul></td></tr>
            <tr><td>Moderate</td><td>31–50%</td><td><ul><li>Mixed symptoms visible across the affected area</li><li>Lesions increasing in size and number</li><li>Moderate stress on plants</li></ul></td></tr>
            <tr><td>Severe</td><td>51–100%</td><td><ul><li>Extensive and overlapping disease symptoms</li><li>Significant to severe yield loss expected</li></ul></td></tr>
          </table>
          <div style="position: absolute; bottom: 40px; width: 100%; text-align: center; color: #6b7280; font-size: 14px; font-style: italic;">
            Generated by OryzAID Results Dashboard
          </div>
        </div>
      `;

      const wrapper = document.createElement("div");
      wrapper.style.position = "fixed";
      wrapper.style.left = "-9999px";
      wrapper.style.top = "0";
      wrapper.innerHTML = htmlContent;
      document.body.appendChild(wrapper);
      
      await wait(500);

      const pages = wrapper.querySelectorAll('.pdf-page');
      const pdf = new window.jspdf.jsPDF("p", "pt", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage();
        showCenterNotif(`Rendering page ${i + 1} of ${pages.length}...`, { showOk: false });
        
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