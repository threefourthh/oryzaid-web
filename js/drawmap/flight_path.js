export function removeFlightPath(ctx) {
  if (ctx.flightPath) {
    ctx.map.removeLayer(ctx.flightPath);
    ctx.flightPath = null;
  }
}

export function generateFlightPath(ctx, spacingMeters = 10) {
  if (!ctx.polygon || !Array.isArray(ctx.points) || ctx.points.length < 3) return;

  const poly = ctx.polygon.toGeoJSON();
  const bbox = turf.bbox(poly);
  const spacingDeg = spacingMeters / 111320;

  const lines = [];
  let reverse = false;

  for (let lat = bbox[1]; lat <= bbox[3]; lat += spacingDeg) {
    const line = turf.lineString([[bbox[0], lat], [bbox[2], lat]]);
    const length = turf.length(line, { units: "degrees" });
    const steps = Math.max(2, Math.floor(length / spacingDeg));

    const clipped = [];
    for (let i = 0; i <= steps; i++) {
      const p = turf.along(line, (i / steps) * length, { units: "degrees" });
      if (turf.booleanPointInPolygon(p, poly)) clipped.push(p.geometry.coordinates);
    }

    if (clipped.length > 1) {
      if (reverse) clipped.reverse();
      reverse = !reverse;
      lines.push(...clipped);
    }
  }

  const finalCoords = lines.map((c) => [c[1], c[0]]);
  finalCoords.unshift(ctx.startPoint);
  finalCoords.push(ctx.startPoint);

  removeFlightPath(ctx);

  ctx.flightPath = L.polyline(finalCoords, {
    color: "#28d966",
    weight: 4,
    dashArray: "4,8",
    opacity: 0.9,
    lineCap: "round",
  }).addTo(ctx.map);

  ctx.flightPath.getElement()?.classList.add("leaflet-dash-flow");
}