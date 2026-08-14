import { NextRequest, NextResponse } from "next/server";

/**
 * Menyelesaikan langkah OAuth install Zoom App.
 *
 * Zoom Marketplace redirect balik ke Home URL (public/zoom-app/index.html)
 * dengan ?code=... setelah user authorize app di browser biasa (bukan di
 * dalam Zoom client). Karena index.html adalah file statis, dia tidak bisa
 * tukar code ini sendiri (butuh Client Secret, tidak boleh ada di browser).
 * app.js fetch ke endpoint ini untuk menyelesaikan pertukaran code -> token
 * di server.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
  }

  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  const redirectUrl = process.env.ZOOM_REDIRECT_URL;

  if (!clientId || !clientSecret || !redirectUrl) {
    return NextResponse.json(
      { ok: false, error: "Server belum dikonfigurasi (ZOOM_CLIENT_ID/ZOOM_CLIENT_SECRET/ZOOM_REDIRECT_URL)" },
      { status: 500 }
    );
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUrl,
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    return NextResponse.json({ ok: false, error: "Tukar code ke Zoom gagal", detail }, { status: 502 });
  }

  // App ini cuma pakai Zoom Apps SDK di sisi client (postMessage bridge di
  // dalam meeting) dan tidak pernah panggil Zoom REST API dari server, jadi
  // access/refresh token dari sini tidak perlu disimpan — cukup pastikan
  // pertukaran code berhasil supaya instalasi selesai dengan benar di
  // sisi Zoom.
  return NextResponse.json({ ok: true });
}
