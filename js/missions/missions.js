// js/missions/missions.js
import { apiGet, apiDelete } from "../core/api.js";
import { initCenterNotif, showCenterConfirm, showCenterPrompt, showCenterNotif } from "../drawmap/center_notif.js";

const LOCAL_KEY = "maizeeye_local_plans_v1";

window.addEventListener("DOMContentLoaded", () => {

  initCenterNotif();
  
  const localList = document.getElementById("localList");
  const cloudList = document.getElementById("cloudList");
  const newPlanBtn = document.getElementById("newPlanBtn");

  // New Mission
  newPlanBtn?.addEventListener("click", () => {
    showCenterPrompt(
      "Optional: Name this mission plan (e.g., Brgy. Caritan Field 1):",
      {
        title: "New Mission Plan",
        placeholder: "e.g., Brgy. Caritan – Field 1",
        defaultValue: "",
        okText: "Create",
        cancelText: "Skip",
        onOk: (val) => {
          const name = (val || "").trim();
          const q = name ? `?name=${encodeURIComponent(name)}` : "";
          window.location.href = `drawmap.html${q}`;
        },
        onCancel: () => {
          window.location.href = "drawmap.html";
        },
      }
    );
  });

  loadLocalPlans(localList);
  loadCloudMissions(cloudList);
  wireLocalActions(localList);
  wireCloudActions(cloudList);
});

/* =========================
   LOCAL PLANS
========================= */

function readLocalPlans() {
  const plans = safeJSON(localStorage.getItem(LOCAL_KEY) || "[]", []);
  return Array.isArray(plans) ? plans : [];
}

function writeLocalPlans(plans) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(plans));
}

function renameLocalPlan(planId, newName) {
  const name = String(newName || "").trim();
  if (!planId || !name) return false;

  const plans = readLocalPlans();
  const idx = plans.findIndex((p) => p?.plan_id === planId);
  if (idx < 0) return false;

  plans[idx].name = name;
  plans[idx].updated_at = new Date().toISOString();
  writeLocalPlans(plans);
  return true;
}

function deleteLocalPlan(planId) {
  if (!planId) return false;
  const plans = readLocalPlans();
  const next = plans.filter((p) => p?.plan_id !== planId);
  writeLocalPlans(next);
  return true;
}

function loadLocalPlans(el) {
  if (!el) return;

  const plans = readLocalPlans();

  if (!plans.length) {
    el.innerHTML = `<div class="empty">No local plans yet.</div>`;
    return;
  }

  plans.sort(
    (a, b) =>
      Date.parse(b?.updated_at || b?.created_at || 0) -
      Date.parse(a?.updated_at || a?.created_at || 0)
  );

  el.innerHTML = plans
    .map((p) => {
      const planId = p?.plan_id || "";
      const title = (p?.name || "").trim() || planId || "Untitled Plan";
      const date = formatDate(p?.updated_at || p?.created_at);

      const polyCount = Array.isArray(p?.polygon) ? p.polygon.length : 0;
      const flightCount = Array.isArray(p?.flight) ? p.flight.length : 0;
      const loc = String(p?.location_label || "").trim();

      const syncBadge = p?.cloud_synced
        ? `<span class="sync-badge synced">Synced ✓</span>`
        : `<span class="sync-badge local">Local only</span>`;

      return `
        <div class="item" data-plan-id="${escapeHTML(planId)}" data-plan-name="${escapeHTML(p?.name || "")}">
          <div class="info">
            <b>${escapeHTML(title)}</b><br/>
            <small>
              ${escapeHTML(date)}
              ${loc ? ` • ${escapeHTML(loc)}` : ""}
              • ${syncBadge}
              • poly:${polyCount}
              • flight:${flightCount}
            </small>
          </div>

          <div class="actions">
            <a class="btn-link" href="drawmap.html?plan_id=${encodeURIComponent(planId)}">Open</a>
            <button class="btn-ghost" type="button" data-act="rename">Rename</button>
            <button class="btn-danger" type="button" data-act="delete">Delete</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function wireLocalActions(container) {
  if (!container) return;

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;

    const row = btn.closest(".item");
    const planId = row?.dataset?.planId || "";
    const currentName = row?.dataset?.planName || "";
    const act = btn.dataset.act;

    if (act === "rename") {
      showCenterPrompt("Rename this plan:", {
        title: "Rename Plan",
        placeholder: "e.g., Brgy. Caritan – Field 2",
        defaultValue: currentName || planId,
        okText: "Save",
        cancelText: "Cancel",
        onOk: (val) => {
          if (!val) return;
          const ok = renameLocalPlan(planId, val);
          if (ok) loadLocalPlans(container);
        },
      });
      return;
    }

    if (act === "delete") {
      showCenterConfirm("Delete this local plan? This cannot be undone.", {
        title: "Delete Plan",
        okText: "Delete",
        cancelText: "Cancel",
        danger: true,
        onOk: () => {
          deleteLocalPlan(planId);
          loadLocalPlans(container);
        },
      });
    }
  });
}

/* =========================
   CLOUD MISSIONS
========================= */

async function loadCloudMissions(el) {
  if (!el) return;

  try {
    const data = await apiGet("/missions");

    const missions = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.missions)
          ? data.missions
          : Array.isArray(data?.data?.missions)
            ? data.data.missions
            : [];

    if (!missions.length) {
      el.innerHTML = `<div class="empty">No cloud missions yet.</div>`;
      return;
    }

    el.innerHTML = missions
      .map((m) => {
        const id = m?.mission_id || m?.id || "";
        const title =
          String(m?.mission_name || "").trim() ||
          String(id || "Mission").trim();

        const date = formatDate(
          m?.capture_time || m?.created_at || m?.timestamp_utc
        );

        const location = String(m?.field_location || "").trim();

        const area =
          m?.area_covered_ha !== undefined &&
          m?.area_covered_ha !== null &&
          m?.area_covered_ha !== ""
            ? `${Number(m.area_covered_ha).toFixed(2)} ha`
            : "";

        const status = String(m?.mission_status || "").trim();

        const meta = [date, location, area, status ? `Status: ${status}` : ""]
          .filter(Boolean)
          .join(" • ");

        return `
          <div class="item" data-cloud-mission-id="${escapeHTML(id)}">
            <div class="info">
              <b>${escapeHTML(title)}</b><br/>
              <small>${escapeHTML(meta)}</small><br/>
              <small class="muted-id">ID: ${escapeHTML(id)}</small>
            </div>
            <div class="actions">
              <a class="btn-link" href="results.html?mission_id=${encodeURIComponent(id)}">View</a>
              <button class="btn-danger" type="button" data-cloud-act="delete">Delete</button>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    el.innerHTML = `<div class="empty">Failed to load cloud missions: ${escapeHTML(err.message)}</div>`;
  }
}

function wireCloudActions(container) {
  if (!container) return;

  container.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-cloud-act]");
    if (!btn) return;

    const row = btn.closest(".item");
    const missionId = row?.dataset?.cloudMissionId || "";
    const act = btn.dataset.cloudAct;

    if (act !== "delete" || !missionId) return;

    showCenterConfirm(
      `Delete cloud mission ${missionId}? This will also remove its detections.`,
      {
        title: "Delete Cloud Mission",
        okText: "Delete",
        cancelText: "Cancel",
        danger: true,
        onOk: async () => {
          try {
            await apiDelete(`/missions/${encodeURIComponent(missionId)}`);
            showCenterNotif("Cloud mission deleted.", {
              title: "Deleted",
              okText: "OK",
            });
            await loadCloudMissions(container);
          } catch (err) {
            console.error("Delete cloud mission failed:", err);
            showCenterNotif(err.message || "Failed to delete cloud mission.", {
              title: "Delete Failed",
              okText: "OK",
            });
          }
        },
      }
    );
  });
}

/* =========================
   HELPERS
========================= */

function safeJSON(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function formatDate(iso) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? new Date(t).toLocaleString() : "—";
}

function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}