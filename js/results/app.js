// js/results/app.js
import { setApiBaseFromWindowOrDefault } from "../core/api.js";
import { initResultsMissions } from "./results_missions.js";
import { initResultsMap } from "./results_map.js";
import { initResultsSummary } from "./results_summary.js";
import { initReportPDF } from "./report_pdf.js";
import { initCenterNotif } from "../drawmap/center_notif.js";
import { initAiSummary } from "./ai_summary.js";

setApiBaseFromWindowOrDefault("https://maize-eye-final.onrender.com");

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