"use client";

import { useEffect, useState } from "react";
import Pusher from "pusher-js";

type BreakoutRoomSummary = { room_name: string; participant_count: number };

type Summary = {
  total_present: number;
  breakout_rooms: BreakoutRoomSummary[];
};

type Attendee = {
  screen_name: string | null;
  is_present: boolean;
  camera_on: boolean | null;
  is_speaking: boolean;
  total_seconds: number;
  first_joined_at: string;
  last_seen_at: string;
};

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${s}d`;
  return `${s}d`;
}

type RoomDetail = {
  room_name: string;
  participant_count: number;
  attendees: Attendee[];
};

const AUTH_HEADERS = { "X-Monitor-Token": process.env.NEXT_PUBLIC_MONITOR_DASHBOARD_TOKEN ?? "" };

export default function DashboardPage({ params }: { params: { meetingUuid: string } }) {
  const { meetingUuid } = params;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [roomNameInput, setRoomNameInput] = useState("");
  const [selectedRoomName, setSelectedRoomName] = useState<string | null>(null);
  const [roomDetail, setRoomDetail] = useState<RoomDetail | null>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [lastUpdate, setLastUpdate] = useState("Belum ada update");
  const [refreshing, setRefreshing] = useState(false);

  function loadSummary() {
    return fetch(`/api/zoom-monitor/sessions/${meetingUuid}/summary`, { headers: AUTH_HEADERS })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setSummary(data);
          setLastUpdate(new Date().toLocaleTimeString());
        }
      })
      .catch(() => {});
  }

  function loadRoomDetail(roomName: string) {
    return fetch(`/api/zoom-monitor/sessions/${meetingUuid}/breakout-rooms/${encodeURIComponent(roomName)}`, {
      headers: AUTH_HEADERS,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setRoomDetail(data))
      .catch(() => {});
  }

  // Tombol refresh manual -- narik ulang data dari server SEKARANG, tanpa
  // nunggu event/poll berikutnya. Ini cuma baca ulang data yang sudah
  // tersimpan di server; kalau peserta baru belum ke-record sama sekali
  // (misal panel yang dipakai monitoring bukan panel milik HOST meeting --
  // Zoom Apps SDK cuma kasih daftar peserta per breakout room ke host),
  // refresh nggak akan memunculkan apa-apa karena datanya memang belum
  // pernah sampai ke server.
  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadSummary();
      if (selectedRoomName) await loadRoomDetail(selectedRoomName);
    } finally {
      setRefreshing(false);
    }
  }

  // Ringkasan level meeting (headcount + daftar nama room) -- ringan, aman
  // di-push tiap kali ada event lewat Pusher.
  useEffect(() => {
    loadSummary();

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

  // Debounce input nama room, cocokkan ke daftar room yang benar-benar ada
  // sebelum narik detailnya -- supaya nggak fetch tiap ketikan huruf.
  useEffect(() => {
    const name = roomNameInput.trim();
    const timer = setTimeout(() => {
      if (!name || !summary) {
        setSelectedRoomName(null);
        return;
      }
      const match = summary.breakout_rooms.find((r) => r.room_name.toLowerCase() === name.toLowerCase());
      setSelectedRoomName(match ? match.room_name : null);
    }, 400);
    return () => clearTimeout(timer);
  }, [roomNameInput, summary]);

  // Cuma narik detail SATU room yang lagi dipilih -- bukan semua room
  // sekaligus. Ke-refresh otomatis tiap kali ringkasan live-update masuk,
  // tapi tetap cuma 1 request per update, bukan 1 per room.
  useEffect(() => {
    if (!selectedRoomName) {
      setRoomDetail(null);
      return;
    }
    let cancelled = false;
    setRoomLoading(true);
    fetch(`/api/zoom-monitor/sessions/${meetingUuid}/breakout-rooms/${encodeURIComponent(selectedRoomName)}`, {
      headers: AUTH_HEADERS,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setRoomDetail(data);
      })
      .finally(() => {
        if (!cancelled) setRoomLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingUuid, selectedRoomName, summary]);

  function copyAttendees() {
    if (!roomDetail) return;
    const text = roomDetail.attendees.map((a, i) => `${i + 1}. ${a.screen_name ?? "-"}`).join("\n");
    navigator.clipboard.writeText(text).then(
      () => {
        setCopyFeedback("Disalin!");
        setTimeout(() => setCopyFeedback(""), 2000);
      },
      () => setCopyFeedback("Gagal menyalin")
    );
  }

  const roomNotFound = roomNameInput.trim().length > 0 && !selectedRoomName;

  return (
    <main style={{ fontFamily: "-apple-system, sans-serif", background: "#f7f7f8", minHeight: "100vh", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Live Monitor — {meetingUuid}</h2>
        <button onClick={handleRefresh} disabled={refreshing} style={refreshButtonStyle}>
          {refreshing ? "Memuat..." : "🔄 Refresh"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginTop: 16, marginBottom: 24 }}>
        <Card title="Total peserta (lobby + breakout)" value={summary?.total_present ?? "-"} />
        <Card title="Jumlah breakout room" value={summary?.breakout_rooms?.length ?? "-"} />
      </div>

      <div style={{ background: "#fff", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
        <label htmlFor="roomNameInput" style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
          Nama breakout room
        </label>
        <input
          id="roomNameInput"
          list="room-name-options"
          value={roomNameInput}
          onChange={(e) => setRoomNameInput(e.target.value)}
          placeholder="Ketik nama breakout room untuk lihat detail monitoring..."
          style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" }}
        />
        <datalist id="room-name-options">
          {summary?.breakout_rooms?.map((r) => (
            <option key={r.room_name} value={r.room_name} />
          ))}
        </datalist>

        {!roomNameInput.trim() && (
          <p style={{ color: "#999", fontSize: 13, marginTop: 12 }}>
            Detail peserta, kamera, dan status bicara cuma diambil untuk breakout room yang diketik di sini
            -- supaya prosesnya ringan walau jumlah room/peserta banyak.
          </p>
        )}

        {roomNotFound && (
          <p style={{ color: "#c5221f", fontSize: 13, marginTop: 12 }}>
            Breakout room &quot;{roomNameInput}&quot; tidak ditemukan.{" "}
            {summary?.breakout_rooms?.length
              ? `Room yang ada: ${summary.breakout_rooms.map((r) => r.room_name).join(", ")}`
              : "Belum ada breakout room tercatat."}
          </p>
        )}

        {roomDetail && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>
                {roomDetail.room_name}
                {roomLoading && <span style={{ fontSize: 11, color: "#999", fontWeight: 400 }}> (memuat...)</span>}
              </h3>
              <button onClick={copyAttendees} style={copyButtonStyle}>
                📋 Copy peserta{copyFeedback ? ` — ${copyFeedback}` : ""}
              </button>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Nama", "Kamera", "Bicara", "Durasi di room", "Status"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, background: "#fafafa", color: "#666" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roomDetail.attendees.length ? (
                  roomDetail.attendees.map((a, i) => (
                    <tr key={i}>
                      <td style={cellStyle}>
                        {a.screen_name ?? "-"} {a.is_speaking && <span style={{ color: "#1a73e8", fontWeight: 600 }}>● bicara</span>}
                      </td>
                      <td style={cellStyle}>
                        <Badge
                          text={a.camera_on === null ? "Tidak diketahui" : a.camera_on ? "Nyala" : "Mati"}
                          tone={a.camera_on === null ? "neutral" : a.camera_on ? "good" : "bad"}
                        />
                      </td>
                      <td style={cellStyle}>{a.is_speaking ? "Aktif" : "Diam"}</td>
                      <td style={cellStyle}>{formatDuration(a.total_seconds)}</td>
                      <td style={cellStyle}>
                        <Badge text={a.is_present ? "Di room" : "Keluar"} tone={a.is_present ? "good" : "neutral"} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={cellStyle} colSpan={5}>
                      Belum ada peserta tercatat di room ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: "#999", marginTop: 12 }}>Update terakhir: {lastUpdate}</div>
    </main>
  );
}

function Card({ title, value }: { title: string; value: string | number }) {
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 13, color: "#666", fontWeight: 500 }}>{title}</h3>
      <div style={{ fontSize: 28, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Badge({ text, tone }: { text: string; tone: "good" | "bad" | "neutral" }) {
  const colors = {
    good: { bg: "#e6f4ea", color: "#137333" },
    bad: { bg: "#fce8e6", color: "#c5221f" },
    neutral: { bg: "#f1f1f1", color: "#888" },
  }[tone];
  return (
    <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, background: colors.bg, color: colors.color }}>
      {text}
    </span>
  );
}

const cellStyle: React.CSSProperties = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid #eee" };

const copyButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  fontSize: 13,
  cursor: "pointer",
};

const refreshButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "#fff",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
