"use client";

import { useEffect, useRef } from "react";
import type { GeoResponse } from "@/lib/api";
import "leaflet/dist/leaflet.css";

interface Props {
  points: GeoResponse["points"];
}

export function GeoHeatmap({ points }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<ReturnType<typeof import("leaflet")["map"]> | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let L: typeof import("leaflet");
    let cleanup: (() => void) | undefined;

    (async () => {
      L = (await import("leaflet")).default;

      // Fix default marker icons broken by webpack
      // @ts-expect-error leaflet internal
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(containerRef.current!, {
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

      // Load leaflet.heat and add heatmap layer
      await import("leaflet.heat");
      // @ts-expect-error leaflet.heat extends L at runtime
      const heat = L.heatLayer(
        points.map((p) => [p.lat, p.lng, p.weight] as [number, number, number]),
        {
          radius: 25,
          blur: 20,
          maxZoom: 17,
          gradient: { 0.4: "#3b82f6", 0.65: "#f59e0b", 1: "#ef4444" },
        }
      ).addTo(map);

      cleanup = () => {
        heat.remove();
        map.remove();
        mapRef.current = null;
      };
    })();

    return () => cleanup?.();
  }, []); // mount only — point updates handled below

  // Update heat layer when points change after initial mount
  useEffect(() => {
    if (!mapRef.current || points.length === 0) return;
    const map = mapRef.current;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet.heat");
      map.eachLayer((layer) => {
        // Remove existing heat layers (they have _latlngs)
        if ("_latlngs" in layer || layer.constructor.name === "HeatLayer") {
          map.removeLayer(layer);
        }
      });
      // @ts-expect-error leaflet.heat extends L at runtime
      L.heatLayer(
        points.map((p) => [p.lat, p.lng, p.weight] as [number, number, number]),
        {
          radius: 25,
          blur: 20,
          maxZoom: 17,
          gradient: { 0.4: "#3b82f6", 0.65: "#f59e0b", 1: "#ef4444" },
        }
      ).addTo(map);
    })();
  }, [points]);

  return <div ref={containerRef} className="h-full w-full" />;
}
