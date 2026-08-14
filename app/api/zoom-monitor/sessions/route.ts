import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const sessions = await prisma.zoomMeetingSession.findMany({
    where: { participants: { some: { isPresent: true } } },
    include: {
      participants: { where: { isPresent: true } },
      breakoutRooms: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(
    sessions.map((session) => ({
      meeting_uuid: session.meetingUuid,
      topic: session.topic,
      started_at: session.startedAt,
      total_present: session.participants.length,
      camera_off_count: session.participants.filter((p) => p.cameraOn === false).length,
      currently_speaking: session.participants.find((p) => p.isSpeaking)?.screenName ?? null,
      breakout_room_count: session.breakoutRooms.length,
    }))
  );
}
