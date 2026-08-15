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
const API_TOKEN = "756b87d7c310aa061e2abe77e257079cbdca8f406598e379"; // shared secret sederhana, lihat catatan keamanan di README

let meetingUUID = null;
let participantsCache = {}; // { participantUUID: { screenName, videoOn, inBreakoutRoom, isSpeaking } }

// State diri sendiri -- dipakai buat scoping laporan kamera/bicara ke
// breakout room yang lagi ditempati, karena Zoom Apps SDK cuma bisa kasih
// tau status kamera/bicara untuk USER YANG PANEL-NYA LAGI DIBUKA (diri
// sendiri), bukan peserta lain. Jadi tiap peserta yang mau dipantau
// kameranya di breakout room WAJIB buka panel ini sendiri.
let myParticipantUUID = null;
let myVideoOn = null;
let myIsSpeaking = false;
let refreshingBreakoutRooms = false; // cegah refreshBreakoutRooms() numpuk kalau dipanggil bertubi-tubi

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
        "getUserContext",
        "getVideoState",
        "onParticipantChange",
        "onMeetingConfigChanged",
        "onActiveSpeakerChange",
        "onMyActiveSpeakerChange",
        "onMyMediaChange",
        "onBreakoutRoomChange",
      ],
    });

    // config() tidak mengembalikan meetingUUID -- itu field terpisah,
    // harus diambil lewat callZoomApi("getMeetingUUID").
    const { meetingUUID: uuid } = await zoomSdk.callZoomApi("getMeetingUUID");
    meetingUUID = uuid;
    setStatus("Terhubung ke meeting: " + meetingUUID);
    log("Zoom App terhubung");

    // getUserContext/getVideoState/onBreakoutRoomChange/onMyActiveSpeakerChange
    // baru ditambah -- kalau app di Zoom Marketplace belum di-enable buat
    // API/Event ini, callZoomApi bakal reject dengan "No Permission for
    // this API [app_not_support]". Dibungkus try/catch masing-masing
    // supaya SATU fitur yang belum di-enable nggak bikin seluruh init()
    // gagal (peserta/breakout room dasar tetap harus jalan).
    try {
      const userContext = await zoomSdk.callZoomApi("getUserContext");
      myParticipantUUID = userContext.participantUUID;
    } catch (err) {
      log("getUserContext belum di-enable di Zoom Marketplace: " + err.message);
    }

    // Ambil status kamera awal (onMyMediaChange cuma nembak kalau ada
    // PERUBAHAN, jadi kalau kamera sudah nyala dari sebelum panel dibuka,
    // status ini yang jadi sumber pertama).
    try {
      const videoState = await zoomSdk.callZoomApi("getVideoState");
      myVideoOn = !!videoState.video;
    } catch (err) {
      myVideoOn = null;
      log("getVideoState belum di-enable di Zoom Marketplace: " + err.message);
    }

    await loadInitialParticipants();
    await refreshBreakoutRooms();
    resendSelfStatus();
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
  // onMeetingConfigChanged, poll berkala, dan onBreakoutRoomChange bisa
  // saling tumpang tindih memanggil ini -- kalau dibiarkan numpuk,
  // getBreakoutRoomList suka timeout ("took longer than 10000ms").
  if (refreshingBreakoutRooms) return;
  refreshingBreakoutRooms = true;
  try {
    const rooms = await zoomSdk.callZoomApi("getBreakoutRoomList");
    const roomList = rooms.rooms || [];
    el("breakoutCount").textContent = roomList.length;
    sendEvent("breakout_room_update", { rooms: roomList });
  } catch (err) {
    log("Gagal ambil breakout room list: " + err.message);
  } finally {
    refreshingBreakoutRooms = false;
  }
}

// Kirim ulang status kamera & bicara diri sendiri saat ini. Dipanggil bukan
// cuma saat ADA PERUBAHAN (onMyMediaChange/onMyActiveSpeakerChange), tapi
// juga dipoll berkala -- soalnya laporan yang dikirim TEPAT saat pindah
// room (via onBreakoutRoomChange) bisa lebih cepat sampai daripada baris
// attendee-nya sendiri ke-tandai "isPresent" di server (yang sumbernya
// breakout_room_update, terpisah). Kalau itu terjadi, laporan pertama
// nggak nemu baris yang cocok dan kamera/bicara tetap "tidak diketahui"
// selamanya sampai ada perubahan berikutnya. Dengan dipoll ulang, dalam
// ~20 detik data bakal nyusul kekoreksi sendiri.
function resendSelfStatus() {
  sendEvent("video_status_self", { participant_uuid: myParticipantUUID, video_on: myVideoOn });
  sendEvent("my_active_speaker_change", { participant_uuid: myParticipantUUID, is_speaking: myIsSpeaking });
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

  // Status kamera on/off diri sendiri. Supaya bisa memantau kamera SEMUA
  // peserta breakout room, tiap peserta wajib buka panel ini sendiri saat
  // masuk breakout room -- lihat catatan di README.
  zoomSdk.addEventListener("onMyMediaChange", (event) => {
    myVideoOn = event.media?.video?.state === "on";
    sendEvent("video_status_self", { participant_uuid: myParticipantUUID, video_on: myVideoOn });
  });

  // Diri sendiri pindah masuk/keluar breakout room -- cuma dipakai buat
  // log & kirim ulang status kamera saat ini supaya langsung tercatat di
  // room baru. TIDAK dipakai buat nentuin nama room: breakoutRoomUUID di
  // event ini ternyata beda namespace dari breakoutRoomId di
  // getBreakoutRoomList, jadi backend yang nentuin room lewat data
  // presence dari breakout_room_update, bukan dari sini. Dibungkus
  // try/catch -- kalau event ini belum di-enable di Zoom Marketplace,
  // addEventListener bisa throw, dan itu nggak boleh gagalin registrasi
  // listener lainnya.
  try {
    zoomSdk.addEventListener("onBreakoutRoomChange", (event) => {
      log(event.action === "join" ? "Masuk breakout room" : "Kembali ke main session");
      resendSelfStatus();
    });
  } catch (err) {
    log("onBreakoutRoomChange belum di-enable di Zoom Marketplace: " + err.message);
  }

  // Status bicara diri sendiri (jalan baik di main session maupun breakout
  // room, beda dengan onActiveSpeakerChange yang cuma lihat room yang lagi
  // ditempati panel host).
  try {
    zoomSdk.addEventListener("onMyActiveSpeakerChange", (event) => {
      myIsSpeaking = event.status === "started";
      sendEvent("my_active_speaker_change", { participant_uuid: myParticipantUUID, is_speaking: myIsSpeaking });
    });
  } catch (err) {
    log("onMyActiveSpeakerChange belum di-enable di Zoom Marketplace: " + err.message);
  }

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
  // berkala supaya rekap kehadiran tetap dapat nama terbaru. Kirim ulang
  // status kamera/bicara diri sendiri di tick yang sama supaya kalau ada
  // yang kelewat di kirim ulang, kamera/bicara ke-koreksi otomatis dalam
  // 20 detik kalau ada race dengan attendee jelas.
  setInterval(() => {
    if (meetingUUID) {
      refreshBreakoutRooms();
      resendSelfStatus();
    }
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
