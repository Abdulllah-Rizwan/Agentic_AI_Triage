"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import type { GeoResponse } from "@/lib/api";
import "leaflet/dist/leaflet.css";

interface Props {
  points: GeoResponse["points"];
}

const HEAT_OPTIONS = {
  radius: 25,
  blur: 20,
  maxZoom: 17,
  gradient: { 0.4: "#3b82f6", 0.65: "#f59e0b", 1: "#ef4444" },
};

function removeHeatLayers(map: LeafletMap) {
  map.eachLayer((layer) => {
    if ("_latlngs" in layer || layer.constructor.name === "HeatLayer") {
      map.removeLayer(layer);
    }
  });
}

export function GeoHeatmap({ points }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  // Keep a ref so async callbacks always read the latest points, not a stale closure.
  const pointsRef = useRef(points);
  pointsRef.current = points;

  // Mount: initialise the Leaflet map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let isMounted = true;

    (async () => {
      const L = (await import("leaflet")).default;
      if (!isMounted || !containerRef.current) return;

      // @ts-expect-error leaflet internal
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({ iconUrl: "", shadowUrl: "" });

      const map = L.map(containerRef.current, {
        center: [24.8607, 67.0011],
        zoom: 10,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { maxZoom: 19 }
      ).addTo(map);

      mapRef.current = map;

      await import("leaflet.heat");
      if (!isMounted) { map.remove(); return; }

      // Use pointsRef so we pick up data that arrived while the import was in-flight.
      if (pointsRef.current.length > 0) {
        L.heatLayer(
          pointsRef.current.map((p) => [p.lat, p.lng, p.weight] as [number, number, number]),
          HEAT_OPTIONS
        ).addTo(map);
      }
    })();

    return () => {
      isMounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update the heat layer whenever points change after mount.
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet.heat");
      removeHeatLayers(map);
      if (points.length > 0) {
        L.heatLayer(
          points.map((p) => [p.lat, p.lng, p.weight] as [number, number, number]),
          HEAT_OPTIONS
        ).addTo(map);
      }
    })();
  }, [points]);

  return <div ref={containerRef} className="h-full w-full" />;
}
