-- AlterEnum: MediaType — add image and video
ALTER TYPE "MediaType" ADD VALUE 'image';
ALTER TYPE "MediaType" ADD VALUE 'video';

-- AlterEnum: TaskType — add send_image and send_video
ALTER TYPE "TaskType" ADD VALUE 'send_image';
ALTER TYPE "TaskType" ADD VALUE 'send_video';
