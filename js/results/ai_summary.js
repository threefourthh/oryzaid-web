// js/results/ai_summary.js

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
    let conf = Number(d.confidence ?? d.score ?? 0);
    
    // Normalize in case the database saves it as 95 instead of 0.95
    if (conf > 1) conf = conf / 100;

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

export function initAiSummary() {
  // 🔥 THE FIX: Just wait for the map to finish loading its data, then instantly grab a copy!
  window.addEventListener("maizeeye:mission-data-loaded", (e) => {
    
    const detections = e.detail?.detections || [];
    const s = computeSummary(detections);

    setText("aiTotalDetections", s.total);
    setText("aiAvgConfidence", percent(s.avg));
    setText("aiHighConfidence", s.high);
    setText("aiMediumConfidence", s.medium);
    setText("aiLowConfidence", s.low);
    
    console.log("✅ AI Summary updated using map data!");
  });
}
