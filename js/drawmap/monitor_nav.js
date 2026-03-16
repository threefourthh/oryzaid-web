// js/drawmap/monitor_nav.js
import { apiPost } from "../core/api.js";
import { showCenterNotif } from "./center_notif.js";
import { saveCurrentPlan, getPlan, listPlans } from "./local_plans.js";

const LOCAL_KEY = "maizeeye_local_plans_v1";

export function initMonitorNav(ctx) {
  const btn =
    document.getElementById("monitorBtn") ||
    document.getElementById("goMonitorBtn");

  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      btn.disabled = true;

      // 1) Save latest planner state first
      saveCurrentPlan(ctx);

      const planId = String(ctx?.state?.planId || "").trim();
      if (!planId) {
        throw new Error("No local plan found.");
      }

      const plan = getPlan(planId);
      if (!plan) {
        throw new Error("Local plan could not be loaded.");
      }

      // 2) Validate plan before sending / using
      const polygon = Array.isArray(plan.polygon) ? plan.polygon : [];
      const flight = Array.isArray(plan.flight) ? plan.flight : [];

      if (polygon.length < 3) {
        throw new Error("Please draw a valid field boundary first.");
      }

      if (flight.length < 2) {
        throw new Error("Please generate a valid flight path first.");
      }

      // 3) Reuse existing cloud mission if already synced
      let missionId = String(plan.cloud_mission_id || "").trim();

      if (!missionId) {
        showCenterNotif("Uploading mission plan to cloud...", {
          title: "Preparing Mission",
          okText: "",
        });

        const payload = {
          plan_id: plan.plan_id,
          cloud_mission_id: "",

          mission_name: (plan.name || "").trim() || plan.plan_id,
          created_at: plan.created_at || null,
          updated_at: plan.updated_at || null,

          area_ha: Number(plan.area_ha) || 0,
          location_label: plan.location_label || "",
          settings: plan.settings || {},

          polygon,
          flight,
          home: plan.home || null,
        };

        const res = await apiPost("/missions/sync", payload);

        missionId =
          res?.mission_id ||
          res?.id ||
          res?.data?.mission_id ||
          res?.data?.id ||
          "";

        if (!missionId) {
          throw new Error("Cloud mission ID was not returned by the server.");
        }

        // Save sync info locally only on first successful upload
        markPlanAsSynced(planId, missionId);
      }

      // 4) Redirect to monitor page
      const url =
        `monitor.html?mission_id=${encodeURIComponent(missionId)}` +
        `&plan_id=${encodeURIComponent(planId)}`;

      window.location.href = url;
    } catch (err) {
      console.error("Go to Monitor failed:", err);

      showCenterNotif(err.message || "Failed to prepare mission.", {
        title: "Cannot Go to Monitor",
        okText: "OK",
      });
    } finally {
      btn.disabled = false;
    }
  });
}

function markPlanAsSynced(planId, missionId) {
  const plans = listPlans();
  const idx = plans.findIndex((p) => p?.plan_id === planId);
  if (idx < 0) return;

  plans[idx].cloud_synced = true;
  plans[idx].cloud_mission_id = missionId;
  plans[idx].uploaded_at = new Date().toISOString();

  localStorage.setItem(LOCAL_KEY, JSON.stringify(plans));
}