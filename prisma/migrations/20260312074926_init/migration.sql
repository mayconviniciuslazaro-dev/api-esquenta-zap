-- CreateEnum
CREATE TYPE "Engine" AS ENUM ('wwjs', 'baileys');

-- CreateEnum
CREATE TYPE "NumberStatus" AS ENUM ('disconnected', 'connecting', 'qr_pending', 'authenticated', 'connected', 'auth_failure');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('audio', 'sticker');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('warm_group', 'warm_pair', 'send_audio', 'send_sticker', 'send_reaction');

-- CreateTable
CREATE TABLE "numbers" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "engine" "Engine" NOT NULL DEFAULT 'wwjs',
    "status" "NumberStatus" NOT NULL DEFAULT 'disconnected',
    "autoReconnect" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConnected" TIMESTAMP(3),

    CONSTRAINT "numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "groupId" TEXT NOT NULL,
    "numberId" TEXT NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("groupId","numberId")
);

-- CreateTable
CREATE TABLE "conversation_logs" (
    "id" SERIAL NOT NULL,
    "fromNumberId" TEXT,
    "toNumberId" TEXT,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TaskType" NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "lastRun" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "media_files" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "filename" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_numberId_fkey" FOREIGN KEY ("numberId") REFERENCES "numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_logs" ADD CONSTRAINT "conversation_logs_fromNumberId_fkey" FOREIGN KEY ("fromNumberId") REFERENCES "numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_logs" ADD CONSTRAINT "conversation_logs_toNumberId_fkey" FOREIGN KEY ("toNumberId") REFERENCES "numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
