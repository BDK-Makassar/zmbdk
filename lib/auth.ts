import { NextRequest } from "next/server";

/**
 * Validasi sederhana pakai shared secret di header X-Monitor-Token.
 * Sama seperti middleware Laravel sebelumnya — cukup untuk mencegah
 * endpoint disalahgunakan pihak luar. Untuk produksi yang lebih ketat,
 * pertimbangkan token short-lived per sesi (lihat catatan di README).
 */
export function isAuthorized(req: NextRequest): boolean {
  const token = req.headers.get("x-monitor-token");
  return Boolean(token) && token === process.env.ZOOM_MONITOR_TOKEN;
}
