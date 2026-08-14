/**
 * BDK Makassar - Zoom Meeting Live Monitor
 * Zoom Apps SDK frontend
 *
 * Panel ini jalan DI DALAM Zoom client (sebagai Zoom App), bukan website terpisah.
 * Tugasnya: listen event meeting (join/leave, video status, active speaker,
 * breakout room), lalu kirim ke Laravel backend supaya bisa ditampilkan
 * di dashboard live (halaman terpisah yang dibuka admin/panitia).
 */

const BACKEND_URL = "https://zmbdk.vercel.app/api/zoom-monitor"; // ganti sesuai domain Vercel kamu
const API_TOKEN = "isi-string-acak-panjang-fadelfaaz"; // shared secret sederhana, lihat catatan keamanan di README

let meetingUUID = null;
let participantsCache = {}; // { participantUUID: { screenName, videoOn, inBreakoutRoom, isSpeaking } }

const el = (id) => document.getElementById(id);
const log = (msg) => {
  const box = el("log");
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.prepend(line);
};

function setStatus(text, ok = true) {
  const box = el("statusBox");
  box.textContent = text;
  box.className = "status " + (ok ? "ok" : "err");
}

// Kirim event ke Laravel backend
async function sendEvent(type, payload) {
  try {
    await fetch(`${BACKEND_URL}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Monitor-Token": API_TOKEN,
      },
      body: JSON.stringify({
        meeting_uuid: meetingUUID,
        type,
        payload,
        sent_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    log(`Gagal kirim event ${type}: ${err.message}`);
  }
}

function updateSummaryUI() {
  const list = Object.values(participantsCache);
  el("totalCount").textContent = list.length;
  el("cameraOffCount").textContent = list.filter((p) => !p.videoOn).length;
  const speaking = list.find((p) => p.isSpeaking);
  el("activeSpeaker").textContent = speaking ? speaking.screenName : "-";
}

async function init() {
  try {
    const configResponse = await zoomSdk.config({
      capabilities: [
        "getMeetingUUID",
        "getMeetingParticipants",
        "getRunningContext",
        "getBreakoutRoomList",
        "onParticipantChange",
        "onMeetingConfigChanged",
        "onActiveSpeakerChange",
        "onMyMediaChange",
      ],
    });

    // config() tidak mengembalikan meetingUUID -- itu field terpisah,
    // harus diambil lewat callZoomApi("getMeetingUUID").
    const { meetingUUID: uuid } = await zoomSdk.callZoomApi("getMeetingUUID");
    meetingUUID = uuid;
    setStatus("Terhubung ke meeting: " + meetingUUID);
    log("Zoom App terhubung");

    await loadInitialParticipants();
    await refreshBreakoutRooms();
    registerListeners();
  } catch (err) {
    setStatus("Gagal terhubung ke Zoom client", false);
    log("Init error: " + err.message);
  }
}

// Ambil snapshot awal peserta (main session)
async function loadInitialParticipants() {
  try {
    const res = await zoomSdk.callZoomApi("getMeetingParticipants");
    (res.participants || []).forEach((p) => {
      participantsCache[p.participantUUID] = {
        screenName: p.screenName,
        // getMeetingParticipants tidak mengembalikan status kamera peserta
        // lain (cuma screenName/participantUUID/role) -- default true di
        // sini, status kamera diri sendiri di-update lewat onMyMediaChange.
        // Lihat batasan di README-NEXTJS.md.
        videoOn: true,
        inBreakoutRoom: null,
        isSpeaking: false,
      };
    });
    updateSummaryUI();
    sendEvent("attendance_snapshot", {
      participants: Object.entries(participantsCache).map(([uuid, p]) => ({
        participant_uuid: uuid,
        screen_name: p.screenName,
        joined: true,
      })),
    });
  } catch (err) {
    log("Gagal ambil daftar peserta awal: " + err.message);
  }
}

// Ambil daftar breakout room + peserta di tiap room, lalu kirim ke backend
// supaya tercatat sebagai rekap kehadiran (nama tetap ada walau sudah
// keluar room, nama ter-update kalau rename). Dipanggil saat init, tiap
// onMeetingConfigChanged, DAN dipoll berkala -- karena rename nama tidak
// selalu memicu onMeetingConfigChanged, cuma perubahan struktur room.
async function refreshBreakoutRooms() {
  try {
    const rooms = await zoomSdk.callZoomApi("getBreakoutRoomList");
    el("breakoutCount").textContent = (rooms.rooms || []).length;
    sendEvent("breakout_room_update", { rooms: rooms.rooms || [] });
  } catch (err) {
    log("Gagal ambil breakout room list: " + err.message);
  }
}

function registerListeners() {
  // Peserta join / leave
  zoomSdk.addEventListener("onParticipantChange", (event) => {
    (event.participants || []).forEach((p) => {
      const status = p.status; // 'join' | 'leave' (cek nama field sesuai versi SDK)
      if (status === "leave") {
        delete participantsCache[p.participantUUID];
        sendEvent("participant_left", {
          participant_uuid: p.participantUUID,
          screen_name: p.screenName,
        });
        log(`${p.screenName} keluar dari meeting`);
      } else {
        participantsCache[p.participantUUID] = participantsCache[p.participantUUID] || {
          screenName: p.screenName,
          videoOn: true,
          inBreakoutRoom: null,
          isSpeaking: false,
        };
        sendEvent("participant_joined", {
          participant_uuid: p.participantUUID,
          screen_name: p.screenName,
        });
        log(`${p.screenName} bergabung`);
      }
    });
    updateSummaryUI();
  });

  // Status kamera on/off (event ini menembak untuk diri sendiri;
  // untuk memantau SEMUA peserta, kombinasikan dengan polling getMeetingParticipants
  // secara berkala karena keterbatasan API kamera peserta lain — lihat catatan di README)
  zoomSdk.addEventListener("onMyMediaChange", (event) => {
    sendEvent("video_status_self", {
      video_on: event.media?.video?.state === "on",
    });
  });

  // Siapa yang sedang aktif bicara (field-nya "users", bukan "activeSpeakers")
  zoomSdk.addEventListener("onActiveSpeakerChange", (event) => {
    Object.values(participantsCache).forEach((p) => (p.isSpeaking = false));
    (event.users || []).forEach((s) => {
      if (participantsCache[s.participantUUID]) {
        participantsCache[s.participantUUID].isSpeaking = true;
      }
    });
    updateSummaryUI();
    sendEvent("active_speaker_change", {
      speakers: (event.users || []).map((s) => s.participantUUID),
    });
  });

  // Perubahan konfigurasi breakout room (dibuat/dibubarkan/berubah)
  zoomSdk.addEventListener("onMeetingConfigChanged", async () => {
    await refreshBreakoutRooms();
    log("Konfigurasi breakout room berubah");
  });
}

// Halaman ini dipakai untuk dua hal berbeda dengan URL yang sama:
// 1. Home URL yang di-load Zoom DI DALAM meeting client -> lanjut ke init()
//    di bawah, connect ke zoomSdk seperti biasa.
// 2. Redirect URL OAuth: Zoom Marketplace redirect balik ke sini di browser
//    BIASA (bukan di dalam Zoom client) setelah user authorize app, dengan
//    ?code=... di URL. zoomSdk.config() pasti gagal di sini karena tidak
//    ada Zoom client untuk diajak komunikasi -- jadi jangan panggil init(),
//    selesaikan pertukaran code lewat backend saja.
const urlCode = new URLSearchParams(window.location.search).get("code");

if (urlCode) {
  handleOAuthRedirect(urlCode);
} else {
  init();
  // Kirim heartbeat tiap 30 detik supaya backend tahu panel masih aktif
  setInterval(() => {
    if (meetingUUID) sendEvent("heartbeat", {});
  }, 30000);
  // Poll breakout room tiap 20 detik -- rename nama peserta di dalam
  // breakout room tidak memicu onMeetingConfigChanged, jadi perlu dipoll
  // berkala supaya rekap kehadiran tetap dapat nama terbaru.
  setInterval(() => {
    if (meetingUUID) refreshBreakoutRooms();
  }, 20000);
}

async function handleOAuthRedirect(code) {
  setStatus("Menyelesaikan instalasi app...");
  try {
    const res = await fetch(`/api/zoom/oauth?code=${encodeURIComponent(code)}`);
    const data = await res.json();
    if (res.ok && data.ok) {
      setStatus("Instalasi berhasil! Buka meeting Zoom, lalu aktifkan app ini dari panel Apps.");
      log("OAuth install selesai");
    } else {
      setStatus("Instalasi gagal: " + (data.error || "unknown error"), false);
      log("OAuth install error: " + JSON.stringify(data));
    }
  } catch (err) {
    setStatus("Instalasi gagal: " + err.message, false);
    log("OAuth install fetch error: " + err.message);
  }
}
