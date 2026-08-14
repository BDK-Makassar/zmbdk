import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { meetingUuid: string } }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const session = await prisma.zoomMeetingSession.findUnique({
    where: { meetingUuid: params.meetingUuid },
  });

  if (!session) {
    return NextResponse.json({ message: "Sesi tidak ditemukan" }, { status: 404 });
  }

  const [participants, breakoutRooms] = await Promise.all([
    prisma.zoomMeetingParticipant.findMany({ where: { sessionId: session.id, isPresent: true } }),
    prisma.zoomBreakoutRoom.findMany({ where: { sessionId: session.id } }),
  ]);

  const speaking = participants.find((p) => p.isSpeaking);

  return NextResponse.json({
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
  });
}
