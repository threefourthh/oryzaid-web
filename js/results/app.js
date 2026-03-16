// js/results/app.js
import { setApiBaseFromWindowOrDefault } from "../core/api.js";
import { initResultsMissions } from "./results_missions.js";
import { initResultsMap } from "./results_map.js";
import { initResultsSummary } from "./results_summary.js";
import { initReportPDF } from "./report_pdf.js";
import { initCenterNotif } from "../drawmap/center_notif.js";
import { initAiSummary } from "./ai_summary.js";

// Set the base URL to your new Render backend
setApiBaseFromWindowOrDefault("https://oryzaid-api.onrender.com");

window.addEventListener("DOMContentLoaded", () => {
  initCenterNotif();

  initResultsMap({ mapId: "map" });
  initResultsSummary();
  initAiSummary();

  initResultsMissions({
    statusId: "missionStatus",
    refreshBtnId: "refreshMissions",
    selectId: "missionSelect",
  });

  initReportPDF({
    btnId: "downloadPdfBtn",
    rootId: "reportRoot",
  });
});


// --- TEMPORARY HEATMAP TEST ---
// This will run automatically 3 seconds after the page loads
setTimeout(() => {
  console.log("Running automatic map test...");
  
  // Make sure the map exists
  if (window.map) {
    // Get whatever coordinates the map is currently looking at
    const center = window.map.getCenter();
    
    // Create massive fake disease points
    const testPoints = [
      [center.lat, center.lng, 1.0], 
      [center.lat + 0.0001, center.lng, 0.9],
      [center.lat, center.lng + 0.0001, 0.9]
    ];
    
    // Force the heatmap onto the screen
    L.heatLayer(testPoints, {
      radius: 40,
      blur: 20,
      minOpacity: 0.5,
      gradient: { 0.4: 'blue', 0.6: 'lime', 1: 'red' }
    }).addTo(window.map);
    
    console.log("✅ TEST SUCCESS: Red heatmap drawn!");
    alert("Test complete! If you see a red spot, your map works perfectly.");
  } else {
    console.error("❌ ERROR: 'window.map' is not found.");
    alert("Map variable not found. Check your map initialization.");
  }
}, 3000); // 3000 milliseconds = 3 seconds
// --- END TEMPORARY TEST ---