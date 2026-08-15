import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pusherServer } from "@/lib/pusher";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs"; // Prisma butuh Node runtime, bukan Edge

type EventPayload = {
  meeting_uuid: string;
  type: string;
  payload?: Record<string, any>;
  sent_at?: string;
};

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as EventPayload;

  if (!body.meeting_uuid || !body.type) {
    return NextResponse.json({ message: "meeting_uuid dan type wajib diisi" }, { status: 422 });
  }

  const session = await prisma.zoomMeetingSession.upsert({
    where: { meetingUuid: body.meeting_uuid },
    update: {},
    create: { meetingUuid: body.meeting_uuid },
  });

  await prisma.zoomMeetingEvent.create({
    data: {
      sessionId: session.id,
      type: body.type,
      payload: body.payload ?? {},
      eventSentAt: body.sent_at ? new Date(body.sent_at) : new Date(),
    },
  });

  await handleEventType(session.id, body.type, body.payload ?? {});

  const summary = await buildSummary(session.id);

  await pusherServer.trigger(`zoom-monitor-${body.meeting_uuid}`, "summary-updated", summary);

  return NextResponse.json({ ok: true });
}

async function handleEventType(sessionId: string, type: string, payload: Record<string, any>) {
  switch (type) {
    case "attendance_snapshot": {
      for (const p of payload.participants ?? []) {
        await prisma.zoomMeetingParticipant.upsert({
          where: { sessionId_participantUuid: { sessionId, participantUuid: p.participant_uuid } },
          update: { screenName: p.screen_name, isPresent: true, joinedAt: new Date() },
          create: {
            sessionId,
            participantUuid: p.participant_uuid,
            screenName: p.screen_name,
            isPresent: true,
            joinedAt: new Date(),
          },
        });
      }
      break;
    }

    case "participant_joined": {
      await prisma.zoomMeetingParticipant.upsert({
        where: { sessionId_participantUuid: { sessionId, participantUuid: payload.participant_uuid } },
        update: { screenName: payload.screen_name, isPresent: true, joinedAt: new Date(), leftAt: null },
        create: {
          sessionId,
          participantUuid: payload.participant_uuid,
          screenName: payload.screen_name,
          isPresent: true,
          joinedAt: new Date(),
        },
      });
      break;
    }

    case "participant_left": {
      await prisma.zoomMeetingParticipant.updateMany({
        where: { sessionId, participantUuid: payload.participant_uuid },
        data: { isPresent: false, leftAt: new Date() },
      });
      break;
    }

    case "video_status_self": {
      if (!payload.participant_uuid) break;
      await prisma.zoomMeetingParticipant.updateMany({
        where: { sessionId, participantUuid: payload.participant_uuid },
        data: { cameraOn: payload.video_on ?? null },
      });
      // Yang sebenarnya mau dipantau: kamera peserta DI DALAM breakout
      // room. Update baris attendee di room manapun peserta ini SEDANG
      // tercatat hadir (isPresent), bukan match berdasarkan nama room yang
      // dikirim client -- ID breakout room dari onBreakoutRoomChange
      // (breakoutRoomUUID) ternyata BEDA namespace dari breakoutRoomId di
      // getBreakoutRoomList, jadi nggak bisa diandalkan buat matching.
      // "isPresent" sendiri sumbernya breakout_room_update yang sudah
      // terbukti akurat.
      await prisma.zoomBreakoutRoomAttendee.updateMany({
        where: { participantUuid: payload.participant_uuid, isPresent: true, breakoutRoom: { sessionId } },
        data: { cameraOn: payload.video_on ?? null },
      });
      break;
    }

    case "my_active_speaker_change": {
      if (!payload.participant_uuid) break;
      await prisma.zoomBreakoutRoomAttendee.updateMany({
        where: { participantUuid: payload.participant_uuid, isPresent: true, breakoutRoom: { sessionId } },
        data: { isSpeaking: !!payload.is_speaking },
      });
      break;
    }

    case "active_speaker_change": {
      const speakerUuids: string[] = payload.speakers ?? [];

      await prisma.zoomMeetingParticipant.updateMany({
        where: { sessionId },
        data: { isSpeaking: false },
      });

      if (speakerUuids.length > 0) {
        await prisma.zoomMeetingParticipant.updateMany({
          where: { sessionId, participantUuid: { in: speakerUuids } },
          data: { isSpeaking: true },
        });
        // Prisma updateMany tidak support increment per-row langsung;
        // untuk speakingSeconds yang presisi per orang, loop satu-satu.
        for (const uuid of speakerUuids) {
          await prisma.zoomMeetingParticipant.updateMany({
            where: { sessionId, participantUuid: uuid },
            data: { speakingSeconds: { increment: 3 } },
          });
        }
      }
      break;
    }

    case "breakout_room_update": {
      for (const room of payload.rooms ?? []) {
        const roomName = room.name ?? `Room ${room.breakoutRoomId ?? "?"}`;
        const roomParticipants: Array<{ participantUUID: string; displayName?: string; participantStatus?: string }> =
          room.participants ?? [];

        const dbRoom = await prisma.zoomBreakoutRoom.upsert({
          where: { sessionId_roomName: { sessionId, roomName } },
          update: { participantCount: roomParticipants.length },
          create: { sessionId, roomName, participantCount: roomParticipants.length },
        });

        // Cuma yang statusnya "joined" dihitung sebagai hadir di room ini
        // (bukan cuma "assigned"/ditugaskan tapi belum masuk).
        const joinedUuids = roomParticipants
          .filter((p) => p.participantStatus === "joined")
          .map((p) => p.participantUUID);

        // Buat ngitung durasi total, kita perlu tau lastSeenAt SEBELUM update
        // ini -- nggak bisa dihitung dalam satu query upsert, jadi ambil
        // dulu baris yang udah ada.
        const existing = await prisma.zoomBreakoutRoomAttendee.findMany({
          where: { breakoutRoomId: dbRoom.id, participantUuid: { in: joinedUuids } },
        });
        const existingByUuid = new Map(existing.map((a) => [a.participantUuid, a]));
        const now = new Date();

        for (const p of roomParticipants) {
          if (p.participantStatus !== "joined") continue;
          const prev = existingByUuid.get(p.participantUUID);
          // Delta cuma dihitung kalau tadinya SUDAH tercatat hadir -- biar
          // durasi keluar-masuk room (mis. sempat pindah room lalu balik)
          // nggak ikut kehitung sebagai waktu di room ini. Dibatasi 5 menit
          // per tick supaya satu gap panjang (mis. sempat nggak ke-poll)
          // nggak nge-bengkakin total durasi.
          const deltaSeconds = prev?.isPresent
            ? Math.min(Math.round((now.getTime() - prev.lastSeenAt.getTime()) / 1000), 300)
            : 0;

          await prisma.zoomBreakoutRoomAttendee.upsert({
            where: {
              breakoutRoomId_participantUuid: { breakoutRoomId: dbRoom.id, participantUuid: p.participantUUID },
            },
            update: {
              screenName: p.displayName,
              isPresent: true,
              lastSeenAt: now,
              totalSeconds: { increment: deltaSeconds },
            },
            create: {
              breakoutRoomId: dbRoom.id,
              participantUuid: p.participantUUID,
              screenName: p.displayName,
              isPresent: true,
            },
          });
        }

        // Yang sebelumnya tercatat hadir tapi sekarang tidak ada di daftar
        // joined -> tandai sudah keluar, tapi baris riwayatnya tetap ada.
        await prisma.zoomBreakoutRoomAttendee.updateMany({
          where: {
            breakoutRoomId: dbRoom.id,
            isPresent: true,
            participantUuid: { notIn: joinedUuids.length ? joinedUuids : ["__none__"] },
          },
          data: { isPresent: false },
        });
      }
      break;
    }

    case "heartbeat":
    default:
      break;
  }
}

// Ringkasan ini dihitung tiap kali ADA EVENT MASUK (dipicu ke Pusher tiap
// kali) -- jadi sengaja dibikin murah: cuma nama room + jumlah peserta,
// TANPA join daftar attendee tiap room. Detail attendee (kamera/bicara)
// per room diambil on-demand lewat endpoint
// sessions/[meetingUuid]/breakout-rooms/[roomName], bukan di sini, supaya
// proses yang jalan di setiap trigger tetap ringan walau room/peserta banyak.
async function buildSummary(sessionId: string) {
  const [participants, breakoutRooms] = await Promise.all([
    prisma.zoomMeetingParticipant.findMany({ where: { sessionId, isPresent: true } }),
    prisma.zoomBreakoutRoom.findMany({ where: { sessionId } }),
  ]);

  return {
    total_present: participants.length,
    breakout_rooms: breakoutRooms.map((r) => ({
      room_name: r.roomName,
      participant_count: r.participantCount,
    })),
    updated_at: new Date().toISOString(),
  };
}
