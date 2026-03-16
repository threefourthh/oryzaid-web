// js/drawmap/local_plans.js
const LS_KEY = "maizeeye_local_plans_v1";

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeAll(plans) {
  localStorage.setItem(LS_KEY, JSON.stringify(plans));
}

function toTitle(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}
function extractBrgyKeyAndPlace(label) {
  // label like: "Caritan Sur, Tuguegarao City, Cagayan"
  const parts = String(label || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const brgy = parts[0] || "Unknown Area";
  const city = parts[1] || "";
  const province = parts[2] || "";

  // Key used for numbering (Barangay only)
  const key = brgy.toLowerCase();

  // Display place in name (still nice)
  // e.g. "Caritan Sur – Tuguegarao City"
  const place = city ? `${brgy} – ${city}` : brgy;

  return { key, place, province };
}

function nextFieldNumberByKey(plans, brgyKey) {
  // We store name_group_key in plans, so numbering is stable
  let maxN = 0;

  for (const p of plans) {
    if (String(p?.name_group_key || "") !== String(brgyKey || "")) continue;

    const n = Number(p?.name_field_no);
    if (Number.isFinite(n)) maxN = Math.max(maxN, n);
  }

  return maxN + 1;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function makePlanId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `plan_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function listPlans() {
  return readAll();
}

export function getPlan(planId) {
  return readAll().find((p) => p.plan_id === planId) || null;
}

/**
 * Create a NEW plan (always new ID).
 * Saves only JSON-safe fields.
 */
export function createNewLocalPlan(ctx, { name = "" } = {}) {
  if (!ctx.state) ctx.state = {};

  const id = makePlanId();
  const now = new Date().toISOString();
  const cleanName = String(name || "").trim();

  ctx.state.planId = id;
  ctx.state.createdAt = now;
  ctx.state.planName = cleanName;
  ctx.state.planNameAuto = false;
  ctx.state.planNameBase = "";

  const plan = {
    plan_id: id,
    name: cleanName,              // ✅ save custom mission name
    name_auto: false,             // ✅ manual name, not auto-generated
    name_base: "",
    name_group_key: "",
    name_field_no: 0,

    created_at: now,
    updated_at: now,

    settings: ctx.state.settings || {},
    polygon: [],
    flight: [],

    area_ha: 0,
    home: null,
    location_label: "",
  };

  const all = readAll();
  all.unshift(plan);
  writeAll(all);
  return plan;
}

/**
 * Update current plan by ctx.state.planId
 */
export function saveCurrentPlan(ctx) {
  const id = ctx.state?.planId;
  if (!id) return null;

  const all = readAll();
  const idx = all.findIndex((p) => p.plan_id === id);

  const updated = {
    plan_id: id,

    // ---------- Name ----------
    name: ctx.state.planName || "",
    name_auto: Boolean(ctx.state.planNameAuto),
    name_base: ctx.state.planNameBase || "",

    // ✅ NEW: numbering per barangay
    name_group_key: ctx.state.planNameGroupKey || "",
    name_field_no: Number(ctx.state.planFieldNo) || 0,

    // ---------- Timestamps ----------
    created_at: ctx.state.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),

    // ---------- Settings ----------
    settings: ctx.state.settings || {},

    // ---------- Geometry ----------
    polygon: (ctx.state.polygonLatLngs || []).map((p) => ({
      lat: p.lat,
      lng: p.lng,
    })),

    flight: (ctx.state.flightWaypoints || []).map((p) => ({
      lat: p.lat,
      lng: p.lng,
    })),

    // ---------- Area ----------
    area_ha: Number(ctx.state.areaHa) || 0,

    // ---------- Location ----------
    home: ctx.state.homeLatLng || null,
    location_label: ctx.state.locationLabel || "",
  };

  if (idx >= 0) all[idx] = updated;
  else all.unshift(updated);

  writeAll(all);
  return updated;
}
/**
 * ✅ Backward compatibility:
 * some older app.js expects exposeLocalMissionsToWindow()
 */
export function exposeLocalMissionsToWindow() {
  window.MaizeEyeLocal = window.MaizeEyeLocal || {};
  window.MaizeEyeLocal.listPlans = listPlans;
  window.MaizeEyeLocal.getPlan = getPlan;
  window.MaizeEyeLocal.createNew = (ctx) => createNewLocalPlan(ctx);
  window.MaizeEyeLocal.save = (ctx) => saveCurrentPlan(ctx);
}


export function loadPlanIntoCtx(ctx, planId) {
  const plan = getPlan(planId);
  if (!plan) return null;

  if (!ctx.state) ctx.state = {};

  // ---------- Identity ----------
  ctx.state.planId = plan.plan_id;
  ctx.state.createdAt = plan.created_at;

  // ---------- Settings ----------
  ctx.state.settings = plan.settings || {};

  // ---------- Geometry ----------
  ctx.state.polygonLatLngs = (plan.polygon || []).map(p => ({
    lat: p.lat,
    lng: p.lng
  }));

  ctx.state.flightWaypoints = (plan.flight || []).map(p => ({
    lat: p.lat,
    lng: p.lng
  }));

  // ---------- Name ----------
  ctx.state.planName = plan.name || "";
  ctx.state.planNameAuto = Boolean(plan.name_auto);
  ctx.state.planNameBase = plan.name_base || "";

  // ✅ NEW: numbering per barangay
  ctx.state.planNameGroupKey = plan.name_group_key || "";
  ctx.state.planFieldNo = Number(plan.name_field_no) || 0;

  // ---------- Area ----------
  ctx.state.areaHa = Number(plan.area_ha) || 0;

  // ---------- Location ----------
  ctx.state.homeLatLng = plan.home || null;
  ctx.state.locationLabel = plan.location_label || "";

  return plan;
}

export function autoNamePlanFromLocation(planId, locationLabel) {
  const label = String(locationLabel || "").trim();
  if (!planId || !label) return null;

  const all = readAll();
  const idx = all.findIndex(p => p?.plan_id === planId);
  if (idx < 0) return null;

  // If user already renamed it manually, do not overwrite
  const existingName = String(all[idx].name || "").trim();
  const existingAuto = Boolean(all[idx].name_auto);
  if (existingName && !existingAuto) return all[idx];

  const { key, place } = extractBrgyKeyAndPlace(label);

  // ✅ Keep existing assigned field number if present
  const existingKey = String(all[idx].name_group_key || "");
  const existingNo = Number(all[idx].name_field_no);

  const fieldNo =
    existingKey === key && Number.isFinite(existingNo) && existingNo > 0
      ? existingNo
      : nextFieldNumberByKey(all, key);

  // Base name (without area)
  const base = `${place} – Field ${fieldNo}`;

  // Add area if available
  const area = Number(all[idx].area_ha) || 0;
  const full = area > 0 ? `${base} (${area.toFixed(2)} ha)` : base;

  // Save auto-name metadata for stable numbering
  all[idx].name = full;
  all[idx].name_auto = true;
  all[idx].name_base = base;

  all[idx].name_group_key = key;      // ✅ NEW
  all[idx].name_field_no = fieldNo;   // ✅ NEW

  all[idx].updated_at = new Date().toISOString();
  writeAll(all);

  return all[idx];
}