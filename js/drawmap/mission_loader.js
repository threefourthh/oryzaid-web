import { apiGet, getApiBase } from "../core/api.js";

export function initMissionDropdown({
  selectId = "missionSelect",
  backBtnId = "backBtn",
  loadedMissionId = "loadedMission", // optional label in UI
} = {}) {
  const sel = document.getElementById(selectId);

  // Back button
  document.getElementById(backBtnId)?.addEventListener("click", () => {
    window.location.href = "missions.html";
  });

  function setStatus(msg) {
    const loaded = document.getElementById(loadedMissionId);
    if (loaded) loaded.textContent = msg || "—";
  }

  function getMissionId(m) {
    return m?.mission_id || m?.id || m?.missionId || m?.mission || "";
  }

  function getMissionDate(m) {
    const raw =
      m?.created_at ||
      m?.createdAt ||
      m?.timestamp_utc ||
      m?.timestamp ||
      m?.gps_timestamp ||
      "";
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }

  function isLocalPlan(m) {
    return m?.type === "plan" || String(m?.mission_id || "").startsWith("plan_");
  }

  function labelForAny(m) {
    const id = getMissionId(m);
    const t = getMissionDate(m);
    const tag = isLocalPlan(m) ? "📝 PLAN" : "☁️ CLOUD";
    return t ? `${tag} ${id} — ${new Date(t).toLocaleString()}` : `${tag} ${id}`;
  }

  function dispatchMission(id) {
    window.dispatchEvent(
      new CustomEvent("maizeeye:mission-selected", {
        detail: { mission_id: id },
      })
    );
  }

  function getLocalPlans() {
    if (typeof window.MAIZEEYE_GET_LOCAL_MISSIONS === "function") {
      return window.MAIZEEYE_GET_LOCAL_MISSIONS() || [];
    }
    return [];
  }

  async function loadMissions() {
    if (!sel) return;

    try {
      sel.innerHTML = `<option value="">Loading…</option>`;
      setStatus("Loading missions...");

      // Uses core/api.js base (backward compatible)
      const payload = await apiGet("/missions");

      const cloudMissions = Array.isArray(payload)
        ? payload
        : (payload?.missions || payload?.data || payload?.data?.missions || []);

      const localPlans = getLocalPlans();
      const missions = [...localPlans, ...cloudMissions];

      if (!missions.length) {
        sel.innerHTML = `<option value="">No missions yet</option>`;
        setStatus("No missions found.");
        return;
      }

      missions.sort((a, b) => getMissionDate(b) - getMissionDate(a));

      sel.innerHTML = "";
      let latestId = null;

      for (const m of missions) {
        const id = getMissionId(m);
        if (!id) continue;

        if (!latestId) latestId = id;

        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = labelForAny(m);
        sel.appendChild(opt);
      }

      if (!latestId) {
        sel.innerHTML = `<option value="">No valid missions</option>`;
        setStatus("No valid mission_id found.");
        return;
      }

      sel.value = latestId;
      setStatus(latestId);
      dispatchMission(latestId);
    } catch (err) {
      console.error("loadMissions error:", err);
      sel.innerHTML = `<option value="">Failed to load</option>`;
      setStatus("Failed to load missions.");
    }
  }

  // Change event
  sel?.addEventListener("change", () => {
    const id = sel.value;
    if (!id) return;
    setStatus(id);
    dispatchMission(id);
  });

  // Auto load
  window.addEventListener("load", loadMissions);
  window.addEventListener("maizeeye:local-missions-updated", loadMissions);

  // Helpful for debugging
  console.log("MaizeEye API:", getApiBase());

  return { loadMissions };
}