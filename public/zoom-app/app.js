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

    meetingUUID = configResponse.meetingUUID;
    setStatus("Terhubung ke meeting: " + meetingUUID);
    log("Zoom App terhubung");

    await loadInitialParticipants();
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
        videoOn: !p.muted && p.videoOn !== false, // sesuaikan field aktual dari SDK versi kamu
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

  // Siapa yang sedang aktif bicara
  zoomSdk.addEventListener("onActiveSpeakerChange", (event) => {
    Object.values(participantsCache).forEach((p) => (p.isSpeaking = false));
    (event.activeSpeakers || []).forEach((s) => {
      if (participantsCache[s.participantUUID]) {
        participantsCache[s.participantUUID].isSpeaking = true;
      }
    });
    updateSummaryUI();
    sendEvent("active_speaker_change", {
      speakers: (event.activeSpeakers || []).map((s) => s.participantUUID),
    });
  });

  // Perubahan konfigurasi breakout room (dibuat/dibubarkan/berubah)
  zoomSdk.addEventListener("onMeetingConfigChanged", async () => {
    try {
      const rooms = await zoomSdk.callZoomApi("getBreakoutRoomList");
      el("breakoutCount").textContent = (rooms.breakoutRoomList || []).length;
      sendEvent("breakout_room_update", { rooms: rooms.breakoutRoomList || [] });
      log("Konfigurasi breakout room berubah");
    } catch (err) {
      log("Gagal ambil breakout room list: " + err.message);
    }
  });
}

init();

// Kirim heartbeat tiap 30 detik supaya backend tahu panel masih aktif
setInterval(() => {
  if (meetingUUID) sendEvent("heartbeat", {});
}, 30000);
