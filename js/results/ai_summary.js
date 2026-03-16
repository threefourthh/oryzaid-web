// js/results/ai_summary.js
import { apiGet } from "../core/api.js";

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function percent(v) {
  const n = Number(v || 0);
  return (n * 100).toFixed(1) + "%";
}

function computeSummary(detections = []) {
  const total = detections.length;

  if (!total) {
    return { total: 0, avg: 0, high: 0, medium: 0, low: 0 };
  }

  let sum = 0;
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const d of detections) {
    const conf = Number(d.confidence ?? d.score ?? 0);
    sum += conf;
    if (conf >= 0.85) high++;
    else if (conf >= 0.6) medium++;
    else low++;
  }

  return {
    total,
    avg: sum / total,
    high,
    medium,
    low
  };
}

async function loadAiSummary(missionId) {
  try {
    // FIX: Removed "/detections" to match your actual Render API route
    const payload = await apiGet(`/missions/${missionId}`);

    let detections = [];
    
    // Extract detections safely from the payload
    if (Array.isArray(payload)) detections = payload;
    else if (payload?.detections) detections = payload.detections;
    else if (payload?.data?.detections) detections = payload.data.detections;
    else if (payload?.results) detections = payload.results;

    const s = computeSummary(detections);

    setText("aiTotalDetections", s.total);
    setText("aiAvgConfidence", percent(s.avg));
    setText("aiHighConfidence", s.high);
    setText("aiMediumConfidence", s.medium);
    setText("aiLowConfidence", s.low);

  } catch (err) {
    console.warn("AI summary failed:", err);
  }
}

export function initAiSummary() {
  window.addEventListener("maizeeye:mission-selected", (e) => {
    const missionId = e?.detail?.missionId || e?.detail?.id || e?.detail;
    if (!missionId) return;
    loadAiSummary(missionId);
  });
}