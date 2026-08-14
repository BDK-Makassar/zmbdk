-- CreateTable
CREATE TABLE "zoom_meeting_sessions" (
    "id" TEXT NOT NULL,
    "meeting_uuid" TEXT NOT NULL,
    "topic" TEXT,
    "started_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zoom_meeting_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zoom_meeting_participants" (
    "id" TEXT NOT NULL,
    "zoom_meeting_session_id" TEXT NOT NULL,
    "participant_uuid" TEXT NOT NULL,
    "screen_name" TEXT,
    "is_present" BOOLEAN NOT NULL DEFAULT true,
    "camera_on" BOOLEAN,
    "is_speaking" BOOLEAN NOT NULL DEFAULT false,
    "breakout_room_name" TEXT,
    "joined_at" TIMESTAMP(3),
    "left_at" TIMESTAMP(3),
    "speaking_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zoom_meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zoom_meeting_events" (
    "id" TEXT NOT NULL,
    "zoom_meeting_session_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "event_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zoom_meeting_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zoom_breakout_rooms" (
    "id" TEXT NOT NULL,
    "zoom_meeting_session_id" TEXT NOT NULL,
    "room_name" TEXT NOT NULL,
    "participant_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zoom_breakout_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zoom_meeting_sessions_meeting_uuid_key" ON "zoom_meeting_sessions"("meeting_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "zoom_meeting_participants_zoom_meeting_session_id_participa_key" ON "zoom_meeting_participants"("zoom_meeting_session_id", "participant_uuid");

-- CreateIndex
CREATE INDEX "zoom_meeting_events_zoom_meeting_session_id_type_idx" ON "zoom_meeting_events"("zoom_meeting_session_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "zoom_breakout_rooms_zoom_meeting_session_id_room_name_key" ON "zoom_breakout_rooms"("zoom_meeting_session_id", "room_name");

-- AddForeignKey
ALTER TABLE "zoom_meeting_participants" ADD CONSTRAINT "zoom_meeting_participants_zoom_meeting_session_id_fkey" FOREIGN KEY ("zoom_meeting_session_id") REFERENCES "zoom_meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zoom_meeting_events" ADD CONSTRAINT "zoom_meeting_events_zoom_meeting_session_id_fkey" FOREIGN KEY ("zoom_meeting_session_id") REFERENCES "zoom_meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zoom_breakout_rooms" ADD CONSTRAINT "zoom_breakout_rooms_zoom_meeting_session_id_fkey" FOREIGN KEY ("zoom_meeting_session_id") REFERENCES "zoom_meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
