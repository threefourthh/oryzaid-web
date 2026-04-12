export function initMap({ mapId = "map" } = {}) {
  // ✅ Hard limit zoom updated to 22 for extreme drone detail
  const map = L.map(mapId, {
    zoomControl: false,
    minZoom: 3,
    maxZoom: 22,
  });

  window.map = map;

  // Default fallback (if GPS fails)
  const fallback = [14.5995, 120.9842]; // Manila
  map.setView(fallback, 13);

  // Add zoom control
  L.control.zoom({ position: "topright" }).addTo(map);

  /* =========================
     Base layers (Google Hybrid + OSM)
  ========================= */

  const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxNativeZoom: 19,
    maxZoom: 22,
    attribution: "© OpenStreetMap contributors",
  });

  // ✅ ADDED: High-Detail Google Hybrid Map (Satellite + Labels)
  const googleHybrid = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    {
      maxZoom: 22,
      maxNativeZoom: 19, 
      crossOrigin: true,
      attribution: "Tiles &copy; Google",
    }
  );

  // Default: Google Hybrid
  googleHybrid.addTo(map);

  // Layer switcher
  const baseMaps = {
    "Satellite View (Google)": googleHybrid,
    "Map View (OSM)": street,
  };

  // We no longer need separate overlays because Google Hybrid includes the labels!
  L.control.layers(baseMaps, {}, { position: "topright" }).addTo(map);

  /* =========================
     GPS center
  ========================= */
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        const userLocation = [lat, lng];

        // ✅ safer default zoom in rural areas
        map.setView(userLocation, 17);

        L.circleMarker(userLocation, {
          radius: 6,
          color: "#1ed760",
          fillColor: "#1ed760",
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup("You are here")
          .openPopup();
      },
      (error) => {
        console.warn("Geolocation failed, using fallback.", error);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return map;
}