-- AlterTable
ALTER TABLE "zoom_breakout_room_attendees" ADD COLUMN     "camera_on" BOOLEAN,
ADD COLUMN     "is_speaking" BOOLEAN NOT NULL DEFAULT false;
