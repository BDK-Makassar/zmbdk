import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";

// Detail lengkap SATU breakout room (nama peserta + status kamera/bicara).
// Sengaja dipisah dari summary supaya dashboard cuma perlu narik data room
// yang lagi diketik/dipilih user, bukan semua room sekaligus.
export async function GET(
  req: NextRequest,
  { params }: { params: { meetingUuid: string; roomName: string } }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const roomName = decodeURIComponent(params.roomName);

  const session = await prisma.zoomMeetingSession.findUnique({
    where: { meetingUuid: params.meetingUuid },
  });
  if (!session) {
    return NextResponse.json({ message: "Sesi tidak ditemukan" }, { status: 404 });
  }

  const room = await prisma.zoomBreakoutRoom.findUnique({
    where: { sessionId_roomName: { sessionId: session.id, roomName } },
    include: { attendees: { orderBy: { screenName: "asc" } } },
  });
  if (!room) {
    return NextResponse.json({ message: "Breakout room tidak ditemukan" }, { status: 404 });
  }

  return NextResponse.json({
    room_name: room.roomName,
    participant_count: room.participantCount,
    attendees: room.attendees.map((a) => ({
      screen_name: a.screenName,
      is_present: a.isPresent,
      camera_on: a.cameraOn,
      is_speaking: a.isSpeaking,
      total_seconds: a.totalSeconds,
      first_joined_at: a.firstJoinedAt,
      last_seen_at: a.lastSeenAt,
    })),
  });
}
