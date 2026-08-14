"use client";

import { useEffect, useState } from "react";
import Pusher from "pusher-js";

type Participant = {
  screen_name: string | null;
  camera_on: boolean | null;
  is_speaking: boolean;
  breakout_room_name: string | null;
  speaking_seconds: number;
};

type Summary = {
  total_present: number;
  camera_off_count: number;
  currently_speaking: string | null;
  breakout_rooms: { room_name: string; participant_count: number }[];
  participants: Participant[];
};

export default function DashboardPage({ params }: { params: { meetingUuid: string } }) {
  const { meetingUuid } = params;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>("Belum ada update");

  useEffect(() => {
    // Load awal via REST, jaga-jaga sebelum event Pusher pertama masuk
    fetch(`/api/zoom-monitor/sessions/${meetingUuid}/summary`, {
      headers: { "X-Monitor-Token": process.env.NEXT_PUBLIC_MONITOR_DASHBOARD_TOKEN ?? "" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setSummary(data))
      .catch(() => {});

    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    });

    const channel = pusher.subscribe(`zoom-monitor-${meetingUuid}`);
    channel.bind("summary-updated", (data: Summary) => {
      setSummary(data);
      setLastUpdate(new Date().toLocaleTimeString());
    });

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(`zoom-monitor-${meetingUuid}`);
      pusher.disconnect();
    };
  }, [meetingUuid]);

  return (
    <main style={{ fontFamily: "-apple-system, sans-serif", background: "#f7f7f8", minHeight: "100vh", padding: 24 }}>
      <h2>Live Monitor — {meetingUuid}</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <Card title="Total hadir" value={summary?.total_present ?? "-"} />
        <Card title="Kamera mati" value={summary?.camera_off_count ?? "-"} />
        <Card title="Sedang bicara" value={summary?.currently_speaking ?? "-"} small />
        <Card title="Jumlah breakout room" value={summary?.breakout_rooms?.length ?? "-"} />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 10, overflow: "hidden" }}>
        <thead>
          <tr>
            {["Nama", "Kamera", "Status", "Breakout room", "Durasi bicara (detik)"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 13, background: "#fafafa", color: "#666" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summary?.participants?.length ? (
            summary.participants.map((p, i) => (
              <tr key={i}>
                <td style={cellStyle}>
                  {p.screen_name ?? "-"} {p.is_speaking && <span style={{ color: "#1a73e8", fontWeight: 600 }}>● bicara</span>}
                </td>
                <td style={cellStyle}>
                  <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, background: p.camera_on ? "#e6f4ea" : "#fce8e6", color: p.camera_on ? "#137333" : "#c5221f" }}>
                    {p.camera_on ? "Nyala" : "Mati"}
                  </span>
                </td>
                <td style={cellStyle}>{p.is_speaking ? "Aktif" : "Diam"}</td>
                <td style={cellStyle}>{p.breakout_room_name ?? "Main session"}</td>
                <td style={cellStyle}>{p.speaking_seconds}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td style={cellStyle} colSpan={5}>Menunggu data...</td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ fontSize: 12, color: "#999", marginTop: 12 }}>Update terakhir: {lastUpdate}</div>
    </main>
  );
}

function Card({ title, value, small }: { title: string; value: string | number; small?: boolean }) {
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 13, color: "#666", fontWeight: 500 }}>{title}</h3>
      <div style={{ fontSize: small ? 16 : 28, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

const cellStyle: React.CSSProperties = { padding: "10px 14px", fontSize: 13, borderBottom: "1px solid #eee" };
