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
        await prisma.zoomBreakoutRoom.upsert({
          where: { sessionId_roomName: { sessionId, roomName } },
          update: { participantCount: (room.participants ?? []).length },
          create: { sessionId, roomName, participantCount: (room.participants ?? []).length },
        });
      }
      break;
    }

    case "heartbeat":
    default:
      break;
  }
}

async function buildSummary(sessionId: string) {
  const [participants, breakoutRooms] = await Promise.all([
    prisma.zoomMeetingParticipant.findMany({ where: { sessionId, isPresent: true } }),
    prisma.zoomBreakoutRoom.findMany({ where: { sessionId } }),
  ]);

  const speaking = participants.find((p) => p.isSpeaking);

  return {
    total_present: participants.length,
    camera_off_count: participants.filter((p) => p.cameraOn === false).length,
    currently_speaking: speaking?.screenName ?? null,
    breakout_rooms: breakoutRooms.map((r) => ({
      room_name: r.roomName,
      participant_count: r.participantCount,
    })),
    participants: participants.map((p) => ({
      screen_name: p.screenName,
      camera_on: p.cameraOn,
      is_speaking: p.isSpeaking,
      breakout_room_name: p.breakoutRoomName,
      speaking_seconds: p.speakingSeconds,
    })),
    updated_at: new Date().toISOString(),
  };
}
