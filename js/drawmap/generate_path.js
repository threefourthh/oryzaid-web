// js/drawmap/generate_path.js
import { showCenterNotif } from "./center_notif.js";

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
    
    const flightAlt = flightAltInput ? parseInt(flightAltInput.value, 10) : 12;
    const takeoffAlt = takeoffAltInput ? parseInt(takeoffAltInput.value, 10) : 15;

    // 3. Save altitudes globally so the Export script can use them later
    window.missionConfig = {
      flightAltitude: flightAlt,
      takeoffAltitude: takeoffAlt
    };

    showCenterNotif("Calculating optimal flight path...", { showOk: false });

    // Simulate processing time for smooth UI
    setTimeout(() => {
      // Dispatch event to trigger your flight path math (handled by flight_path.js)
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