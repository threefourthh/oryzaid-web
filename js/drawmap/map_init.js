export function initMap({ mapId = "map" } = {}) {
  // ✅ Hard limit zoom to avoid rural blank tiles
  const map = L.map(mapId, {
    zoomControl: false,
    minZoom: 3,
    maxZoom: 18,
  });

  window.map = map;

  // Default fallback (if GPS fails)
  const fallback = [14.5995, 120.9842]; // Manila
  map.setView(fallback, 13);

  // Add zoom control
  L.control.zoom({ position: "topright" }).addTo(map);

  /* =========================
     Base layers (Satellite + Map) + Labels overlay
  ========================= */

  const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxNativeZoom: 18,
    maxZoom: 18,
    attribution: "© OpenStreetMap contributors",
  });

  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 18,
      maxZoom: 18,
      attribution: "Tiles © Esri",
    }
  );

  const labels = L.tileLayer(
    "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 18,
      maxZoom: 18,
      attribution: "Labels © Esri",
      opacity: 0.95,
    }
  );

  // Default: Satellite + Labels
  satellite.addTo(map);
  labels.addTo(map);

  // Layer switcher
  const baseMaps = {
    "Satellite View": satellite,
    "Map View": street,
  };

  const overlays = {
    Labels: labels,
  };

  L.control.layers(baseMaps, overlays, { position: "topright" }).addTo(map);

  // Labels only on Satellite
  map.on("baselayerchange", (e) => {
    if (e.name === "Satellite View") {
      if (!map.hasLayer(labels)) labels.addTo(map);
    } else {
      if (map.hasLayer(labels)) map.removeLayer(labels);
    }
  });

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