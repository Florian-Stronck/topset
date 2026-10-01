# Multi-coach teams — plan

> **Status (2026-09-30):** build steps 1–4 **built for 0.6.0** (step 5, column-level merge, waits for real lost edits).
> Tests: `src/lib/sync-teams.test.ts`.

## Older desktop apps (built)

The server serves apps from before teams exactly as before. `knowsTeams(request)` in
`src/lib/desktop-version.ts` checks `X-Topset-Version` against `TEAMS_VERSION` (0.6.0):

- **Older apps** get owner-only snapshots, athlete data and plan pulls, so no teammate's
  athlete (whose coach row they lack) ever reaches them. `part=access` and `part=athletes`
  answer "Unknown part." to them. The plan log is filtered by athlete, so an older app still
  receives a teammate's edits to athletes it owns.
- **Newer apps against an older server:** `part=access` failing with 400 is skipped, and
  `Athlete.teamId` is never pushed (`PULLED_COLUMNS`), so they sync as 0.5.0 did.
- `MIN_DESKTOP_VERSION` is unchanged: nobody is forced to update.

A gym or club has several coaches who share a roster: a head coach and assistants who all see and
edit the same athletes, sometimes the same athlete at the same time.

## Decisions

| Question | Answer |
|---|---|
| Which model? | **Team/gym**: coaches on a team share its athletes and can all edit them. Not read-only sharing, not a plan split between coaches. |
| Same athlete at the same time? | **Sometimes.** Row-level "last push wins" is acceptable, with no merging within a row. |
| Who creates teams? | **Only the admin**, who also adds and removes coaches. Coaches don't invite each other. |
| Roles inside a team? | **None.** Every member edits every team athlete. |
| Does the athlete app show which coach wrote what? | **No.** |
| Billing? | **Not yet.** |

## What already exists

- **Separate coach accounts on the server:** `Coach` rows, invites, an admin, disable, reset and delete. Each desktop app signs in as one coach and syncs only what that coach owns.
- **One place for ownership:** `ownedIdsSql` in `src/lib/coach-scope.ts` walks each table's parent chain up to `Athlete.coachId`. `checkPush`, `snapshot`, `athleteData`, `planData` and `deleteCoach` all go through it.
- **Plan data comes down (0.5.0).** It used to only go up. The pieces that make that work:
  - **`PlanChange` (server):** logs every pushed plan row with its `coachId` and the pushing `sessionId`.
  - **`GET sync?part=plan&since=<rev>`:** returns rows other sessions changed, plus deletes.
  - **`SyncSent` + `SyncMeta` (desktop):** remember what each computer last sent and how far it has read the log.
  - **`applyPlan` in `src/lib/sync.ts`:** applies pulled rows. An unsent local edit wins, and a delete cascades locally.
  - **Server leniency (`withoutVanished` in `src/lib/sync-server.ts`):** a removal of a row that's already gone is skipped, and a row added under a parent that's gone is dropped.
  - **Coverage:** `src/lib/sync-two-computers.test.ts` covers two desktops on one account.

  Two computers on one account and two coaches on one athlete are the same problem at the row level, so most of the hard part is done.

## Schema

```prisma
model Team {
  id      String       @id @default(cuid())
  name    String
  members TeamMember[]
}

model TeamMember {
  teamId  String
  coachId String
  team    Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
  @@id([teamId, coachId])
  @@index([coachId])
}

// Athlete: add
teamId String?   // null = private to coachId
```

- `Athlete.coachId` stays as the **owner**. Only the owner can delete the athlete or move it into or out of a team.
- **Deleting a team:** its athletes go back to being private to their owners (`teamId = null`), and nothing is deleted.
- `Team` and `TeamMember` are server-side. Desktops get read-only copies through sync, so they can show team names and teammates. Add them to `SERVER_TABLES`, or to a new pull-only set.

## Server

1. **Access rule, in one place.** At the Athlete level, `ownedIdsSql` becomes "my athletes, or athletes on a team I'm in":
   ```sql
   SELECT "id" FROM "Athlete"
   WHERE "coachId" = ?
      OR "teamId" IN (SELECT "teamId" FROM "TeamMember" WHERE "coachId" = ?)
   ```
   Written like that it takes the coach id twice, and callers mix it with other `?` args (e.g. the chunked `IN (?, ?, …) AND "id" IN (…)` fetch). Keep it at **one `?`** instead, so no caller changes:
   ```sql
   SELECT a."id" FROM "Athlete" a, (SELECT ? AS "me") m
   WHERE a."coachId" = m."me"
      OR a."teamId" IN (SELECT "teamId" FROM "TeamMember" WHERE "coachId" = m."me")
   ```
   Everything below Athlete inherits it.
   - Keep a separate **owner-only** rule for: deleting an Athlete row, changing `Athlete.teamId` or `Athlete.coachId`, and `deleteCoach` (which must delete only the coach's *own* athletes, never team ones).
   - `checkPush`: `"An athlete can only be yours."` becomes "an athlete you create is yours". Editing a team athlete keeps its original `coachId`.
2. **`PlanChange` scoping.** The log is filtered by the *pushing* `coachId` today. For teams, add an `athleteId` column, filled at push time with the athlete each row belongs to (`athletesOf` already traces it). `planData` then reads `WHERE athleteId IN (<access rule>)`, so coach B sees coach A's edits to shared athletes and nothing of A's private athletes.
   - `athletesOf` returns one set for the whole push, not an athlete per row. Logging needs a per-row trace, and new rows can hang off parents that arrive in the same push, so trace from the push itself first, then the database. Removed rows must be traced before the delete runs.
   - `planRev` also reads `WHERE "coachId" = ?`; switch it to the same athlete rule, or a snapshot's starting rev misses teammates' edits.
   - **Alternative:** keep filtering by `coachId`, widened to teammates, and rely on the ownership filter in the row fetch. Don't: rows you can't access would come back as "removed". That's harmless but noisy, and it leaks ids.
3. **`athleteVersion`.** When an athlete logs something, bump it for **every coach with access**, not only the owner. Same for a coach's own athlete-column or merged-row edits.
4. **Plan notices (`PlanNotice`).** Mostly works already: the row is unique per athlete and every push overwrites `coachId` and `changedAt`, so two coaches editing one athlete already share one debounce, and the last pusher's poll (or the cron) flushes it. Only check: the notice speaks in the **owner's** voice (`coachVoice(athlete.coachId)`), which matches "the athlete app doesn't show who wrote what".
5. **Admin routes.** Next to `src/app/api/coach/coaches`: create, rename and delete teams; add and remove members. Admin only (`withCoach(..., { admin: true })`).

## Desktop

- **Who "me" is.** `getCoach()` in `src/lib/queries.ts` uses `prisma.coach.findFirst`. That breaks once teammates' `Coach` rows exist locally, and `Athlete.coachId` is a foreign key to `Coach`, so they have to. Use `config.coachId` from `topset-cloud.json`, falling back to the only coach when signed out.
- **Roster.** My athletes plus my teams' athletes, with a small team dot and name on shared ones. It's a dot, never a coloured left bar (see the no-left-accent rule).
- **Teammates' Coach rows.** Pull `id` and `name` only; the local `Coach` table has other columns, so fill defaults. Never push them: `checkPush` already refuses any Coach row that isn't your own.
- **Revocation.** When a coach leaves a team, or an athlete leaves one, the plan pull (or a new `part=access`) returns "drop athlete X". The desktop deletes it locally, and the cascade does the rest, plus `SyncSent` cleanup. Without this, the old copy lingers and its rows show up as removals on the next push. Those pushes are harmless now because removals of rows that no longer exist are skipped, but it's still wrong.
- **⚠ Take-over mode.** A restore or "Sync everything" (the `takeOver` path in `baseline()` in `sync.ts`) deletes from the server everything this computer doesn't have. With teams, that would delete **teammates' athletes** that aren't on this computer yet. Before shipping teams, limit take-over deletes to the coach's own athletes (`coachId = me`), or make the `ids` snapshot owner-only.
- **Settings stay per coach.** `Coach.settings` holds exercise lists and preferences. A teammate's athlete may use exercises that aren't in your list. Check how the grid and pickers handle an exercise they don't know before building. Shared team libraries come later, if ever.

## Conflicts

- **v1:** the last push wins, per whole row, as it does now across two computers. Two coaches changing different cells of the same ExerciseRow at nearly the same time lose one change.
- **Cheap upgrade:** push only the changed columns. The desktop can tell which ones by comparing against what it last sent, but `SyncSent` stores only a digest, so the last-sent values would have to be kept too.
- **UX, later:** "Anna edited this week 3 min ago" on the week tab, from `PlanChange` (add who and when).
- **Shared review marks:** "Reviewed" (`Day.reviewedAt`) is one mark per session for the whole team: whoever reviews it, it's reviewed for everyone.

## Admin UI

- **Settings → Coaches (admin):** a Teams section to create and rename teams, add and remove coaches, and delete a team (after a confirmation that says its athletes go back to their owners).
- **Athlete card:** a "Team: none / X" picker, which only the owner can change. It lists only teams the owner belongs to.

## Build order

1. **Schema and access.** Add `Team` and `TeamMember`, `Athlete.teamId` and `PlanChange.athleteId`. Split `ownedIdsSql` into access and owner rules, fix the `checkPush` owner rules and `deleteCoach`, and fix the take-over scope. Tests: two coaches sharing one athlete, each with one private athlete. Extend `sync-two-computers.test.ts` into "two coaches".
2. **Server fan-out.** `planData` by athlete, `athleteVersion` for everyone with access, plan notices per athlete.
3. **Desktop.** Current coach from the sign-in, roster with team marks, teammates' Coach rows, revocation.
4. **Admin screens** and the team picker on the athlete card.
5. **Column-level merge**, if lost edits actually happen.

## Open questions for when a gym shows up

- Should a teammate be able to **add** a new athlete straight to the team? (The owner would then be whoever created it.)
- Can a gym want a coach who **only sees** some athletes? That would bring back roles, which were deliberately left out.
- How many coaches and athletes per team? It decides whether the plan pull's `IN (<access rule>)` needs an index or a cache.
