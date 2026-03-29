// js/drawmap/generate_path.js
import { showCenterNotif } from "./center_notif.js";

/**
 * Initializes the Generate Path button logic and UI flow.
 */
export function initGeneratePath(map, drawnItems, pathLayer) {
  const generateBtn = document.getElementById("generatePathBtn");
  const exportBtn = document.getElementById("exportBtn");
  const monitorBtn = document.getElementById("monitorBtn");
  const statusValue = document.querySelector("#plannerStatus .value");

  if (!generateBtn) return;

  generateBtn.addEventListener("click", () => {
    // 1. Check if the user has drawn a field boundary
    const layers = drawnItems.getLayers();
    if (layers.length === 0) {
      showCenterNotif("Please draw a field boundary first.", { showOk: true });
      return;
    }

    // 2. Read the new Altitude Dropdowns from the HTML
    const flightAltInput = document.getElementById("altitudeInput");
    const takeoffAltInput = document.getElementById("takeoffInput");
    
    // Fallback to 2m (the sweet spot) if not set
    const flightAlt = flightAltInput ? parseInt(flightAltInput.value, 10) : 2;
    const takeoffAlt = takeoffAltInput ? parseInt(takeoffAltInput.value, 10) : 15;

    // 3. Save altitudes globally so the Export script can use them later
    window.missionConfig = {
      flightAltitude: flightAlt,
      takeoffAltitude: takeoffAlt,
      flightSpeedMS: 2 // Defaulting to the 2m/s "Sweet Spot" we proved in the thesis
    };

    showCenterNotif("Calculating aligned flight path...", { showOk: false });

    // Simulate processing time for smooth UI
    setTimeout(() => {
      // Dispatch event to trigger the flight path math
      const event = new CustomEvent("maizeeye:generate-path", {
        detail: {
          polygon: layers[0].toGeoJSON(),
          flightAlt: flightAlt,
          takeoffAlt: takeoffAlt
        }
      });
      window.dispatchEvent(event);

      // Update the Mission Status UI to "READY"
      if (statusValue) {
        statusValue.textContent = "READY";
        statusValue.setAttribute("data-state", "ready");
      }
      
      // Enable the Action Buttons
      if (exportBtn) exportBtn.disabled = false;
      if (monitorBtn) monitorBtn.disabled = false;

      // Show success popup with the captured altitudes
      showCenterNotif(
        `Path generated successfully!\n\nFlight Altitude: ${flightAlt}m\nTakeoff Altitude: ${takeoffAlt}m`, 
        { showOk: true, okText: "Awesome" }
      );
    }, 600);
  });
}

/**
 * Generates a high-density "beaded" lawnmower path inside the drawn polygon.
 * Automatically aligns the path to the longest edge of the field.
 * Uses strict Point-in-Polygon rasterization to prevent floating-point skipping.
 * Requires: turf loaded globally
 */
export function generateLawnmowerPath({
  polygonLatLngs,
  flightAlt = null,
  speedMS = null,
  angleDeg = 0
}) {
  // 1) Convert Leaflet latlngs -> GeoJSON polygon
  const ring = polygonLatLngs.map(p => [p.lng, p.lat]);
  ring.push(ring[0]); // close ring
  let poly = turf.polygon([ring]);

  // 2) Find the Longest Edge (To align flight lines parallel to the field)
  const coords = poly.geometry.coordinates[0];
  let maxDist = 0;
  let alignAngle = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = turf.point(coords[i]);
    const p2 = turf.point(coords[i+1]);
    const dist = turf.distance(p1, p2, { units: 'kilometers' });
    if (dist > maxDist) {
      maxDist = dist;
      alignAngle = turf.bearing(p1, p2);
    }
  }

  // Rotate the polygon so its longest edge becomes perfectly horizontal
  const center = turf.centerOfMass(poly);
  // If bearing is 45, rotating by -45 brings it to 0 (North). Add 90 to make it East (Horizontal).
  const rotationAngle = -alignAngle + 90;
  const rotatedPoly = turf.transformRotate(poly, rotationAngle, { pivot: center });

  // 3) Calculate Dense Spacing Math (Thesis Physics)
  const targetAlt = flightAlt || window.missionConfig?.flightAltitude || 2;
  const targetSpeed = speedMS || window.missionConfig?.flightSpeedMS || 2;

  // Overlap: 40% of altitude. (e.g., 1m alt = 0.4m spacing. 2m alt = 0.8m spacing)
  // Hard minimum of 0.3m ensures it never loops infinitely.
  const rowSpacingMeters = Math.max(0.3, targetAlt * 0.4); 
  const pointSpacingMeters = Math.max(0.3, targetSpeed); // 1 photo per second

  // 4) Rasterize the bounding box (Point-in-Polygon check)
  const bbox = turf.bbox(rotatedPoly);
  
  // Convert meters to decimal degrees
  const stepY = rowSpacingMeters / 111320; 
  const midLat = (bbox[1] + bbox[3]) / 2;
  const stepX = pointSpacingMeters / (111320 * Math.cos(midLat * Math.PI / 180));

  const waypoints = [];
  let sweepRight = true;
  
  // Start sweeping from the bottom to the top
  let currentY = bbox[1] + (stepY / 2);

  while (currentY <= bbox[3]) {
    let rowPoints = [];
    let currentX = bbox[0];
    
    // Sweep left to right along the row
    while (currentX <= bbox[2]) {
      const pt = turf.point([currentX, currentY]);
      
      // Strict check: Is this exact point inside the field boundary?
      if (turf.booleanPointInPolygon(pt, rotatedPoly)) {
        rowPoints.push({ lng: currentX, lat: currentY });
      }
      currentX += stepX;
    }

    // If we found valid points inside the field for this row...
    if (rowPoints.length > 0) {
      // Zigzag logic
      if (!sweepRight) {
        rowPoints.reverse();
      }
      
      // Unrotate this entire row back to the field's real-world angle
      const fc = turf.featureCollection(rowPoints.map(p => turf.point([p.lng, p.lat])));
      const unrotatedFc = turf.transformRotate(fc, -rotationAngle, { pivot: center });
      
      unrotatedFc.features.forEach(f => {
        waypoints.push({
          lng: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1]
        });
      });
      
      sweepRight = !sweepRight; // Flip direction for the next row
    }
    currentY += stepY;
  }

  // 5) If the user manually rotated the polygon via Leaflet Geoman, unrotate the points again
  if (angleDeg !== 0 && waypoints.length) {
    const fc = turf.featureCollection(
      waypoints.map(w => turf.point([w.lng, w.lat]))
    );
    const unrot2 = turf.transformRotate(fc, -angleDeg, { pivot: center });
    return unrot2.features.map(f => ({
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1]
    }));
  }

  return waypoints;
}