-- Wrong sign-in tries, so a username (or the setup code) locks for a while after too many.
-- Server-side only, never synced.

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "lastAt" DATETIME NOT NULL
);
