"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type SessionSummary = {
  meeting_uuid: string;
  topic: string | null;
  started_at: string | null;
  total_present: number;
  camera_off_count: number;
  currently_speaking: string | null;
  breakout_room_count: number;
};

const POLL_INTERVAL_MS = 5000;

export default function ZoomMonitoringPage() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>("Belum ada update");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/zoom-monitor/sessions", {
          headers: { "X-Monitor-Token": process.env.NEXT_PUBLIC_MONITOR_DASHBOARD_TOKEN ?? "" },
        });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = (await res.json()) as SessionSummary[];
        if (cancelled) return;
        setSessions(data);
        setError(null);
        setLastUpdate(new Date().toLocaleTimeString());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Gagal memuat data");
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <main style={{ fontFamily: "-apple-system, sans-serif", background: "#f7f7f8", minHeight: "100vh", padding: 24 }}>
      <h2>Sesi Meeting Aktif</h2>

      {error && (
        <div style={{ background: "#fce8e6", color: "#c5221f", padding: "8px 12px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          Gagal memuat: {error}
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 10, overflow: "hidden" }}>
        <thead>
          <tr>
            {["Topik", "Meeting UUID", "Hadir", "Kamera mati", "Sedang bicara", "Breakout room", ""].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 13, background: "#fafafa", color: "#666" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions === null ? (
            <tr>
              <td style={cellStyle} colSpan={7}>Memuat...</td>
            </tr>
          ) : sessions.length === 0 ? (
            <tr>
              <td style={cellStyle} colSpan={7}>Tidak ada sesi meeting yang sedang aktif.</td>
            </tr>
          ) : (
            sessions.map((s) => (
              <tr key={s.meeting_uuid}>
                <td style={cellStyle}>{s.topic ?? "-"}</td>
                <td style={{ ...cellStyle, fontFamily: "monospace", fontSize: 12 }}>{s.meeting_uuid}</td>
                <td style={cellStyle}>{s.total_present}</td>
                <td style={cellStyle}>{s.camera_off_count}</td>
                <td style={cellStyle}>{s.currently_speaking ?? "-"}</td>
                <td style={cellStyle}>{s.breakout_room_count}</td>
                <td style={cellStyle}>
                  <Link href={`/zoom-monitor/${s.meeting_uuid}`} style={{ color: "#1a73e8" }}>
                    Buka dashboard →
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div style={{ fontSize: 12, color: "#999", marginTop: 12 }}>Update terakhir: {lastUpdate}</div>
    </main>
  );
}

const cellStyle: React.CSSProperties = { padding: "10px 14px", fontSize: 13, borderBottom: "1px solid #eee" };
