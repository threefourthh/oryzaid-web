import { showCenterNotif } from "./center_notif.js";
import { removeFlightPath } from "./flight_path.js";
import { getLocalMissions } from "./local_plans.js";

function setStatus(boxId, state, text) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const valueEl = box.querySelector(".value");
  if (!valueEl) return;
  valueEl.dataset.state = state;
  valueEl.textContent = text || state.toUpperCase();
}

function setStartEnabled(enabled) {
  const btn = document.getElementById("startBtn");
  if (!btn) return;
  btn.disabled = !enabled;
  btn.style.cursor = enabled ? "pointer" : "not-allowed";
  btn.style.opacity = enabled ? "1" : "0.6";
}

export function initFlightSim(ctx) {
  let rpiConnected = false;
  let pixConnected = false;

  setStatus("rpiStatus", "disconnected", "DISCONNECTED");
  setStatus("pixhawkStatus", "disconnected", "DISCONNECTED");
  setStartEnabled(false);

  // click status blocks to simulate connect
  document.getElementById("rpiStatus")?.addEventListener("click", () => {
    rpiConnected = !rpiConnected;
    setStatus("rpiStatus", rpiConnected ? "connected" : "disconnected", rpiConnected ? "CONNECTED" : "DISCONNECTED");
    setStartEnabled(rpiConnected && pixConnected);
  });

  document.getElementById("pixhawkStatus")?.addEventListener("click", () => {
    pixConnected = !pixConnected;
    setStatus("pixhawkStatus", pixConnected ? "connected" : "disconnected", pixConnected ? "CONNECTED" : "DISCONNECTED");
    setStartEnabled(rpiConnected && pixConnected);
  });

  // start flight
  document.getElementById("startBtn")?.addEventListener("click", () => {
    if (!(rpiConnected && pixConnected)) return;

    showCenterNotif("STARTED FLYING.\nPLEASE DON'T CLOSE OR TURN OFF YOUR DEVICE...", { showOk: false });

    setTimeout(() => {
      showCenterNotif("Flight finished successfully!", {
        okText: "View Results",
        onOk: () => {
          const missions = getLocalMissions();
          const latest = missions[0]?.mission_id;
          if (latest) window.location.href = `results.html?mission_id=${encodeURIComponent(latest)}`;
          else window.location.href = "results.html";
        }
      });

      removeFlightPath(ctx);
    }, 3500);
  });
}