-- CreateTable
CREATE TABLE "zoom_breakout_room_attendees" (
    "id" TEXT NOT NULL,
    "zoom_breakout_room_id" TEXT NOT NULL,
    "participant_uuid" TEXT NOT NULL,
    "screen_name" TEXT,
    "is_present" BOOLEAN NOT NULL DEFAULT true,
    "first_joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zoom_breakout_room_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zoom_breakout_room_attendees_zoom_breakout_room_id_particip_key" ON "zoom_breakout_room_attendees"("zoom_breakout_room_id", "participant_uuid");

-- AddForeignKey
ALTER TABLE "zoom_breakout_room_attendees" ADD CONSTRAINT "zoom_breakout_room_attendees_zoom_breakout_room_id_fkey" FOREIGN KEY ("zoom_breakout_room_id") REFERENCES "zoom_breakout_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
