-- CreateTable users
CREATE TABLE "users" (
    "id"        TEXT          NOT NULL,
    "username"  TEXT          NOT NULL,
    "password"  TEXT          NOT NULL,
    "machineId" TEXT,
    "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AddColumn userId (nullable) to all user-owned tables
ALTER TABLE "numbers"         ADD COLUMN "userId" TEXT;
ALTER TABLE "groups"          ADD COLUMN "userId" TEXT;
ALTER TABLE "scheduled_tasks" ADD COLUMN "userId" TEXT;
ALTER TABLE "media_files"     ADD COLUMN "userId" TEXT;

-- AddForeignKey
ALTER TABLE "numbers"         ADD CONSTRAINT "numbers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "groups"          ADD CONSTRAINT "groups_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "media_files"     ADD CONSTRAINT "media_files_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
