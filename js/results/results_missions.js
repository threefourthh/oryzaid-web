// js/results/results_missions.js
// Results page:
// 1) loads mission list from GET /missions
// 2) prefers mission from URL (?mission_id=... or ?mission=...)
// 3) falls back to first cloud mission
// 4) fills mission metadata
// 5) dispatches: maizeeye:mission-selected

import { apiGet } from "../core/api.js";

export function initResultsMissions({
  statusId = "missionStatus",
  refreshBtnId = "refreshMissions",
  selectId = "missionSelect",
} = {}) {
  const statusEl = document.getElementById(statusId);
  const refreshBtn = document.getElementById(refreshBtnId);
  const selectEl = document.getElementById(selectId);

  let lastMissionId = null;

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const text = String(value ?? "").trim();
    el.textContent = text || "—";
  }

  function setStatusText(text) {
    if (!statusEl) return;
    const clean = String(text ?? "").trim();
    statusEl.textContent = clean || "—";
  }

  function getParams() {
    return new URLSearchParams(window.location.search);
  }

  function getQueryMissionId() {
    const params = getParams();
    return (params.get("mission_id") || params.get("mission") || "").trim();
  }

  function firstNonEmpty(...values) {
    for (const v of values) {
      const s = String(v ?? "").trim();
      if (s) return s;
    }
    return "";
  }

  function formatArea(value) {
    const s = String(value ?? "").trim();
    if (!s) return "—";
    return /ha$/i.test(s) ? s : `${s} ha`;
  }

  function formatAltitude(value) {
    const s = String(value ?? "").trim();
    if (!s) return "—";
    return /m$/i.test(s) ? s : `${s} m`;
  }

  function fillMissionMeta({
    missionId = "",
    place = "",
    area = "",
    altitude = "",
    droneId = "",
    captureTime = "",
  } = {}) {
    setText("metaMissionId", missionId || "—");
    setText("metaPlace", place || "—");
    setText("metaArea", area || "—");
    setText("metaAltitude", altitude || "—");
    setText("metaDroneId", droneId || "—");
    setText("metaCaptureTime", captureTime || "—");
  }

  function getUrlMeta(missionId) {
    const params = getParams();

    return {
      missionId: missionId || "—",
      place: params.get("place") || "",
      area: params.get("area_ha") ? formatArea(params.get("area_ha")) : "",
      altitude: params.get("alt_m") ? formatAltitude(params.get("alt_m")) : "",
      droneId: params.get("drone_id") || "",
      captureTime: params.get("capture_time") || "",
    };
  }

  function normalizeMissionsPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.missions)) return payload.missions;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.data?.missions)) return payload.data.missions;
    return [];
  }

  function missionValue(m) {
    return firstNonEmpty(m?.mission_id, m?.missionId, m?.id);
  }

  function missionLabel(m) {
    return firstNonEmpty(
      m?.mission_name,
      m?.missionName,
      m?.mission_id,
      m?.id,
      "Unnamed Mission"
    );
  }

  function extractBackendMeta(payload, missionId) {
    const mission =
      payload?.mission ||
      payload?.data?.mission ||
      payload?.data ||
      payload ||
      {};

    return {
      missionId: firstNonEmpty(
        mission?.mission_id,
        mission?.missionId,
        payload?.mission_id,
        payload?.missionId,
        missionId
      ),
      place: firstNonEmpty(
        mission?.place,
        mission?.location,
        mission?.field_location,
        mission?.site,
        mission?.barangay,
        mission?.municipality
      ),
      area: firstNonEmpty(
        mission?.area_covered_ha != null ? formatArea(mission.area_covered_ha) : "",
        mission?.area_ha != null ? formatArea(mission.area_ha) : "",
        mission?.area != null ? formatArea(mission.area) : "",
        mission?.flight_area != null ? formatArea(mission.flight_area) : ""
      ),
      altitude: firstNonEmpty(
        mission?.flight_altitude_m != null ? formatAltitude(mission.flight_altitude_m) : "",
        mission?.alt_m != null ? formatAltitude(mission.alt_m) : "",
        mission?.altitude != null ? formatAltitude(mission.altitude) : "",
        mission?.flight_altitude != null ? formatAltitude(mission.flight_altitude) : ""
      ),
      droneId: firstNonEmpty(
        mission?.drone_id,
        mission?.droneId,
        mission?.uav_id,
        mission?.aircraft_id
      ),
      captureTime: firstNonEmpty(
        mission?.capture_time,
        mission?.captured_at,
        mission?.created_at,
        mission?.timestamp,
        payload?.capture_time,
        payload?.created_at
      ),
    };
  }

  function mergeMeta(primary, fallback) {
    return {
      missionId: firstNonEmpty(primary?.missionId, fallback?.missionId, "—"),
      place: firstNonEmpty(primary?.place, fallback?.place, "—"),
      area: firstNonEmpty(primary?.area, fallback?.area, "—"),
      altitude: firstNonEmpty(primary?.altitude, fallback?.altitude, "—"),
      droneId: firstNonEmpty(primary?.droneId, fallback?.droneId, "—"),
      captureTime: firstNonEmpty(primary?.captureTime, fallback?.captureTime, "—"),
    };
  }

  function dispatchMission(id, { force = false } = {}) {
    const missionId = String(id ?? "").trim();
    if (!missionId) return;

    if (!force && missionId === lastMissionId) return;
    lastMissionId = missionId;

    window.__MAIZEEYE_MISSION_ID__ = missionId;

    window.dispatchEvent(
      new CustomEvent("maizeeye:mission-selected", {
        detail: { missionId, mission_id: missionId },
      })
    );
  }

  function updateUrlMission(missionId) {
    const url = new URL(window.location.href);
    url.searchParams.set("mission_id", missionId);
    window.history.replaceState({}, "", url.toString());
  }

  async function loadMissionMeta(missionId, { force = false } = {}) {
    if (!missionId) {
      setStatusText("—");
      fillMissionMeta({});
      return;
    }

    setStatusText(missionId);

    const urlMeta = getUrlMeta(missionId);
    fillMissionMeta(urlMeta);

    try {
      const payload = await apiGet(`/missions/${encodeURIComponent(missionId)}`);
      const backendMeta = extractBackendMeta(payload, missionId);
      const finalMeta = mergeMeta(backendMeta, urlMeta);
      fillMissionMeta(finalMeta);
    } catch (err) {
      console.warn("Mission metadata fetch failed, using fallback values only:", err);
    }

    dispatchMission(missionId, { force });
  }

  async function loadMissionList({ force = false } = {}) {
    try {
      setStatusText("Loading missions...");

      const payload = await apiGet("/missions");
      const missions = normalizeMissionsPayload(payload);

      if (!missions.length) {
        setStatusText("No missions found");
        fillMissionMeta({});
        if (selectEl) {
          selectEl.innerHTML = `<option value="">No missions available</option>`;
        }
        return;
      }

      const queryMissionId = getQueryMissionId();
      const missionIds = missions.map(missionValue).filter(Boolean);
      const selectedMissionId =
        missionIds.includes(queryMissionId) ? queryMissionId : missionIds[0];

      if (selectEl) {
        selectEl.innerHTML = missions
          .map((m) => {
            const value = missionValue(m);
            const label = missionLabel(m);
            return `<option value="${value}">${label}</option>`;
          })
          .join("");

        selectEl.value = selectedMissionId;

        selectEl.onchange = async () => {
          const missionId = String(selectEl.value || "").trim();
          if (!missionId) return;
          updateUrlMission(missionId);
          await loadMissionMeta(missionId, { force: true });
        };
      }

      updateUrlMission(selectedMissionId);
      await loadMissionMeta(selectedMissionId, { force });
    } catch (err) {
      console.error("Failed to load missions:", err);

      const fallbackMissionId = getQueryMissionId();
      if (fallbackMissionId) {
        await loadMissionMeta(fallbackMissionId, { force: true });
      } else {
        setStatusText("Failed to load missions");
        fillMissionMeta({});
      }
    }
  }

  refreshBtn?.addEventListener("click", () => loadMissionList({ force: true }));

  loadMissionList({ force: true });

  window.addEventListener("popstate", () => {
    loadMissionList({ force: true });
  });
}