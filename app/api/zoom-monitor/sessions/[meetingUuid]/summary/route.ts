import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";

// Ringkasan level meeting: total peserta (lobby + breakout digabung, karena
// getMeetingParticipants Zoom memang begitu) dan daftar nama breakout room
// yang ada. Detail peserta per room (kamera/bicara) sengaja TIDAK di sini
// -- itu diambil terpisah lewat
// sessions/[meetingUuid]/breakout-rooms/[roomName] cuma untuk room yang
// lagi dilihat, biar nggak perlu query+transfer semua room sekaligus.
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

  const [totalPresent, breakoutRooms] = await Promise.all([
    prisma.zoomMeetingParticipant.count({ where: { sessionId: session.id, isPresent: true } }),
    prisma.zoomBreakoutRoom.findMany({ where: { sessionId: session.id }, orderBy: { roomName: "asc" } }),
  ]);

  return NextResponse.json({
    total_present: totalPresent,
    breakout_rooms: breakoutRooms.map((r) => ({
      room_name: r.roomName,
      participant_count: r.participantCount,
    })),
  });
}
