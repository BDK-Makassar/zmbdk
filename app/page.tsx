import Link from "next/link";

export const metadata = {
  title: "Zoom Live Monitor - BDK Makassar",
};

export default function HomePage() {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const redirectUri = process.env.ZOOM_REDIRECT_URL;
  const zoomLoginUrl =
    clientId && redirectUri
      ? `https://zoom.us/oauth/authorize?response_type=code&client_id=${encodeURIComponent(
          clientId
        )}&redirect_uri=${encodeURIComponent(redirectUri)}`
      : null;

  return (
    <main style={{ fontFamily: "-apple-system, sans-serif", background: "#f7f7f8", minHeight: "100vh", padding: 24 }}>
      <div style={{ maxWidth: 640, margin: "40px auto" }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>BDK Makassar — Zoom Meeting Monitor</h1>
        <p style={{ color: "#666", fontSize: 14, marginBottom: 32 }}>
          Panel monitoring peserta, kamera, active speaker, dan breakout room untuk meeting Zoom.
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          {zoomLoginUrl ? (
            <a href={zoomLoginUrl} style={navButtonStyle("#1a73e8", "#fff")}>
              <span>🔐 Login / Hubungkan Akun Zoom</span>
              <span style={arrowStyle}>→</span>
            </a>
          ) : (
            <div style={warningBoxStyle}>
              Login Zoom belum bisa dipakai — env var <code>ZOOM_CLIENT_ID</code> dan{" "}
              <code>ZOOM_REDIRECT_URL</code> belum di-set. Ambil dari halaman App Credentials di Zoom App
              Marketplace, lalu isi di Vercel → Settings → Environment Variables.
            </div>
          )}

          <Link href="/zoom-monitoring" style={navButtonStyle("#fff", "#111", true)}>
            <span>📊 Sesi Meeting Aktif</span>
            <span style={arrowStyle}>→</span>
          </Link>

          <div style={infoBoxStyle}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>📎 Panel Zoom App</div>
            <p style={{ margin: "0 0 8px", color: "#666" }}>
              Panel ini jalan DI DALAM Zoom client (dibuka lewat sidebar Apps saat meeting), bukan dibuka
              langsung di browser. Dipakai sebagai <strong>Home URL</strong> di konfigurasi Zoom App
              Marketplace:
            </p>
            <code style={codeBoxStyle}>{redirectUri ?? "https://domain-vercel-kamu.vercel.app/zoom-app/index.html"}</code>
          </div>
        </div>
      </div>
    </main>
  );
}

function navButtonStyle(bg: string, color: string, bordered = false): React.CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 18px",
    borderRadius: 10,
    background: bg,
    color,
    textDecoration: "none",
    fontSize: 15,
    fontWeight: 500,
    border: bordered ? "1px solid #e0e0e0" : "none",
    boxShadow: bordered ? "none" : "0 1px 3px rgba(0,0,0,0.12)",
  };
}

const arrowStyle: React.CSSProperties = { opacity: 0.7 };

const warningBoxStyle: React.CSSProperties = {
  padding: "14px 18px",
  borderRadius: 10,
  background: "#fef7e0",
  color: "#7a5c00",
  fontSize: 13,
  lineHeight: 1.5,
};

const infoBoxStyle: React.CSSProperties = {
  padding: "14px 18px",
  borderRadius: 10,
  background: "#fff",
  border: "1px solid #e0e0e0",
  fontSize: 13,
};

const codeBoxStyle: React.CSSProperties = {
  display: "block",
  padding: "8px 10px",
  borderRadius: 6,
  background: "#f1f3f4",
  fontSize: 12,
  wordBreak: "break-all",
};
