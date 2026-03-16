import { disableMapDragging, enableMapDragging } from "./map_init.js";
import { generateFlightPath, removeFlightPath } from "./flight_path.js";
import { newMissionId, saveLocalMission } from "./local_plans.js";
import { showCenterNotif } from "./center_notif.js";
import { showDrawUI, showFlightUI } from "./ui_state.js";

export function calculateAreaHa(latlngs) {
  if (!latlngs || latlngs.length < 3) return 0;

  let area = 0;
  const radius = 6378137;

  for (let i = 0; i < latlngs.length; i++) {
    const p1 = latlngs[i];
    const p2 = latlngs[(i + 1) % latlngs.length];

    area += ((p2.lng - p1.lng) * Math.PI) / 180 *
      (2 + Math.sin((p1.lat * Math.PI) / 180) + Math.sin((p2.lat * Math.PI) / 180));
  }

  area = Math.abs((area * radius * radius) / 2);
  return area / 10000;
}

export function initDrawTools(ctx) {
  // state
  ctx.points = [];
  ctx.redoStack = [];
  ctx.polygon = null;
  ctx.flightPath = null;
  ctx.act = "draw";

  // elements
  const areaEl = document.getElementById("areaDisplay");
  const tools = document.querySelectorAll(".tool");
  const drawbtn = document.getElementById("draw");
  const dragbtn = document.getElementById("drag");
  const doneBtn = document.getElementById("done");
  const confirmWrapper = document.getElementById("confirmWrapper");
  const editBtn = document.getElementById("editBtn");
  const clearBtn = document.getElementById("clear");
  const undoBtn = document.getElementById("undo");
  const redoBtn = document.getElementById("redo");
  const confirmBtn = document.getElementById("confirmBtn");

  // start in draw mode
  disableMapDragging(ctx.map);
  showDrawUI();

  // map click draws polygon
  ctx.map.on("click", (e) => {
    if (ctx.act !== "draw") return;

    ctx.points.push(e.latlng);
    ctx.redoStack = [];

    if (!ctx.polygon) {
      ctx.polygon = L.polygon(ctx.points, { color: "red", weight: 2, fillOpacity: 0.2 }).addTo(ctx.map);
    } else {
      ctx.polygon.setLatLngs(ctx.points);
    }

    if (ctx.points.length >= 3) {
      const latlngs = ctx.polygon.getLatLngs()[0];
      const areaHa = calculateAreaHa(latlngs);
      if (areaEl) areaEl.innerText = `Area: ${areaHa.toFixed(2)} ha`;
    }
  });

  // draw / drag switch
  tools.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.id !== "draw" && btn.id !== "drag") return;

      if (btn.id === "drag") {
        ctx.act = "drag";
        enableMapDragging(ctx.map);
        dragbtn?.classList.add("active");
        drawbtn?.classList.remove("active");
      }

      if (btn.id === "draw") {
        ctx.act = "draw";
        disableMapDragging(ctx.map);
        drawbtn?.classList.add("active");
        dragbtn?.classList.remove("active");
      }
    });
  });

  // undo
  undoBtn?.addEventListener("click", () => {
    if (ctx.act !== "draw" || ctx.points.length === 0) return;

    ctx.redoStack.push(ctx.points.pop());

    if (ctx.points.length < 3) {
      if (ctx.polygon) {
        ctx.map.removeLayer(ctx.polygon);
        ctx.polygon = null;
      }
      if (areaEl) areaEl.innerText = "Area: 0 ha";
      return;
    }

    ctx.polygon?.setLatLngs(ctx.points);
    const areaHa = calculateAreaHa(ctx.polygon.getLatLngs()[0]);
    if (areaEl) areaEl.innerText = `Area: ${areaHa.toFixed(2)} ha`;
  });

  // redo
  redoBtn?.addEventListener("click", () => {
    if (ctx.act !== "draw" || ctx.redoStack.length === 0) return;

    ctx.points.push(ctx.redoStack.pop());

    if (!ctx.polygon) {
      ctx.polygon = L.polygon(ctx.points, { color: "red", weight: 2, fillOpacity: 0.2 }).addTo(ctx.map);
    } else {
      ctx.polygon.setLatLngs(ctx.points);
    }

    if (ctx.points.length >= 3) {
      const areaHa = calculateAreaHa(ctx.polygon.getLatLngs()[0]);
      if (areaEl) areaEl.innerText = `Area: ${areaHa.toFixed(2)} ha`;
    }
  });

  // clear
  function clearAll() {
    if (ctx.polygon) {
      ctx.map.removeLayer(ctx.polygon);
      ctx.polygon = null;
    }
    ctx.points = [];
    ctx.redoStack = [];
    if (areaEl) areaEl.innerText = "Area: 0 ha";
  }

  clearBtn?.addEventListener("click", () => {
    clearAll();
    removeFlightPath(ctx);
    doneBtn && (doneBtn.style.display = "");
    confirmWrapper && (confirmWrapper.style.display = "none");
    tools.forEach((b) => (b.disabled = false));
    showDrawUI();
    disableMapDragging(ctx.map);
    ctx.act = "draw";
  });

  // done (generate path + lock tools)
  doneBtn?.addEventListener("click", () => {
    if (!ctx.polygon || ctx.points.length < 3) {
      showCenterNotif("Please draw an area first.");
      return;
    }

    generateFlightPath(ctx, 10);
    ctx.act = "drag";
    enableMapDragging(ctx.map);

    doneBtn.style.display = "none";
    confirmWrapper.style.display = "flex";

    tools.forEach((b) => (b.disabled = true));
    showFlightUI();
  });

  // edit
  editBtn?.addEventListener("click", () => {
    removeFlightPath(ctx);

    doneBtn && (doneBtn.style.display = "");
    confirmWrapper && (confirmWrapper.style.display = "none");
    tools.forEach((b) => (b.disabled = false));

    showDrawUI();
    disableMapDragging(ctx.map);
    ctx.act = "draw";
  });

  // confirm (save local mission plan)
  confirmBtn?.addEventListener("click", () => {
    if (!ctx.polygon || !ctx.flightPath || ctx.points.length < 3) {
      showCenterNotif("Please draw an area first.");
      return;
    }

    const mission_id = newMissionId();
    const polyLatLngs = ctx.polygon.getLatLngs()[0];
    const pathLatLngs = ctx.flightPath.getLatLngs();

    const missionPlan = {
      mission_id,
      type: "plan",
      created_at: new Date().toISOString(),
      area_ha: calculateAreaHa(polyLatLngs),
      polygon: polyLatLngs.map((p) => ({ lat: p.lat, lng: p.lng })),
      flight_path: pathLatLngs.map((p) => ({ lat: p.lat, lng: p.lng })),
    };

    saveLocalMission(missionPlan);

    window.dispatchEvent(new CustomEvent("maizeeye:local-missions-updated"));
    window.dispatchEvent(new CustomEvent("maizeeye:mission-selected", { detail: { mission_id } }));

    showCenterNotif(`New mission plan saved: ${mission_id}`, { okText: "OK" });
  });

  // new mission reset listener
  window.addEventListener("maizeeye:new-mission", () => {
    clearAll();
    removeFlightPath(ctx);
    doneBtn && (doneBtn.style.display = "");
    confirmWrapper && (confirmWrapper.style.display = "none");
    tools.forEach((b) => (b.disabled = false));
    showDrawUI();
    disableMapDragging(ctx.map);
    ctx.act = "draw";
  });

  return {
    clearAll,
  };
}