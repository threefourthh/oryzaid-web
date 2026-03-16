// js/drawmap/generate_path.js
// Generates a lawnmower (zigzag) path inside the drawn polygon (Geoman)
// Requires: turf loaded globally

export function generateLawnmowerPath({
  polygonLatLngs,
  spacingMeters = 8,
  angleDeg = 0
}) {
  // 1) Convert Leaflet latlngs -> GeoJSON polygon
  const ring = polygonLatLngs.map(p => [p.lng, p.lat]);
  ring.push(ring[0]); // close ring

  let poly = turf.polygon([ring]);

  // 2) Rotate polygon if user wants (optional)
  if (angleDeg !== 0) {
    const center = turf.centerOfMass(poly);
    poly = turf.transformRotate(poly, angleDeg, { pivot: center });
  }

  // 3) Create bbox + grid lines
  const bbox = turf.bbox(poly); // [minX, minY, maxX, maxY]

  // We'll make vertical lines (north-south) spaced by spacingMeters
  // Turf works in km for many functions
  const spacingKm = spacingMeters / 1000;

  const lines = [];
  let x = bbox[0];

  while (x <= bbox[2]) {
    const line = turf.lineString([
      [x, bbox[1]],
      [x, bbox[3]]
    ]);
    lines.push(line);
    // move x by spacingKm in degrees approx? -> we should shift using turf.destination
    // Better: move in meters using turf.destination from a point
    const p = turf.point([x, (bbox[1] + bbox[3]) / 2]);
    const moved = turf.destination(p, spacingKm, 90); // 90° east
    x = moved.geometry.coordinates[0];
  }

  // 4) Clip lines to polygon
  const clipped = [];
  for (const ln of lines) {
    const inter = turf.lineIntersect(ln, poly);

    // If line crosses polygon boundary, we can split and keep inside segments
    // Easiest: use turf.lineSplit with polygon boundary, then filter inside
    const boundary = turf.polygonToLine(poly);
    const split = turf.lineSplit(ln, boundary);

    split.features.forEach(seg => {
      const mid = turf.along(seg, turf.length(seg) / 2);
      if (turf.booleanPointInPolygon(mid, poly)) clipped.push(seg);
    });
  }

  // 5) Sort segments left-to-right, then zigzag order
  clipped.sort((a, b) => {
    const ax = turf.bbox(a)[0];
    const bx = turf.bbox(b)[0];
    return ax - bx;
  });

  const waypoints = [];
  clipped.forEach((seg, i) => {
    let coords = seg.geometry.coordinates; // [ [lng,lat], [lng,lat] ]
    // zigzag reverse every other
    if (i % 2 === 1) coords = coords.slice().reverse();

    // push endpoints
    coords.forEach(c => waypoints.push({ lng: c[0], lat: c[1] }));
  });

  // 6) If we rotated polygon, rotate path back so it matches map orientation
  if (angleDeg !== 0 && waypoints.length) {
    const fc = turf.featureCollection(
      waypoints.map(w => turf.point([w.lng, w.lat]))
    );
    const center = turf.centerOfMass(poly);
    const unrot = turf.transformRotate(fc, -angleDeg, { pivot: center });

    return unrot.features.map(f => ({
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1]
    }));
  }

  return waypoints;
}