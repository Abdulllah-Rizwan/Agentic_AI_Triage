"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import type { CaseListItem } from "@/lib/api";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

interface Props {
  cases: CaseListItem[];
  onCaseClick: (caseId: string) => void;
}

const markerStyle: Record<string, { color: string; radius: number }> = {
  RED: { color: "#dc2626", radius: 10 },
  AMBER: { color: "#f59e0b", radius: 8 },
  GREEN: { color: "#16a34a", radius: 6 },
};

export function CasesMap({ cases, onCaseClick }: Props) {
  useEffect(() => {
    // Fix default Leaflet icon in Next.js
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({ iconUrl: "", shadowUrl: "" });
  }, []);

  return (
    <MapContainer
      center={[24.8607, 67.0011]}
      zoom={11}
      style={{ height: "100%", width: "100%" }}
      className="rounded-xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
      />
      {cases.map((c) => {
        const style = markerStyle[c.triage_level] ?? markerStyle.GREEN;
        return (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lng]}
            radius={style.radius}
            pathOptions={{
              color: style.color,
              fillColor: style.color,
              fillOpacity: 0.85,
              weight: 2,
            }}
            eventHandlers={{ click: () => onCaseClick(c.id) }}
          >
            <Popup>
              <div className="text-xs">
                <p className="font-semibold">{c.triage_level}</p>
                <p>{c.chief_complaint}</p>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
