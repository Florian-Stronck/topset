# Sharing athletes between coaches

> **Status (2026-10-06):** built for 0.9.0, replacing teams (0.6.0–0.8.x).
> Tests: `src/lib/sync-shares.test.ts`, `src/lib/athlete-shares-migration.test.ts`.

A coach shares **one athlete at a time** with another coach on the same Topset server, by
code, with one of three roles. Nobody else is involved: no admin, no teams.

| Role | Sees | Can change |
|---|---|---|
| `view` | everything | nothing |
| `review` | everything | the Reviewed mark on sessions (`Day.reviewedAt`), notes to the athlete (`CoachMessage`) |
| `edit` | everything | everything the owner can, except deleting the athlete or sharing it on |

The athlete's `coachId` stays the **owner**. Only the owner makes codes, changes roles,
stops sharing, or deletes the athlete. A shared coach can leave.

## Codes

`ShareCode` (server only): the owner picks the role, one coach or any number (`reusable`),
and 1, 7 or 30 days or never (`expiresAt` null). A one-coach code goes once used. Entering
a code upserts `AthleteShare(athleteId, coachId, role)`, so a second code changes the role.
Redeeming is rate-limited per coach (`allowTry("share:<coachId>")`).

API: `GET/POST /api/coach/shares` (actions `code`, `redeem`, `role`, `remove`, `dropCode`),
called from `manageShare` / `listShareCodes` in `src/app/settings/cloud-actions.ts`.

## Server rules

- **Reading:** `ownedIdsSql(table, true)` = own athletes or any share. `ownedIdsSql(table, "edit")`
  / `"review"` = shares at least that strong. Everything under an athlete inherits it.
- **Writing (`applyPush`):** checked as before against edit-level access. What is under a
  view or review athlete is **dropped, not refused** (`withoutReadOnly` in `coach-scope.ts`),
  so a desktop that changed one anyway keeps syncing the rest. A review athlete's Day rows
  keep only `reviewedAt`; its notes go through the merged channel with review enough.
- **Older desktop apps** (`knowsShares`, `SHARES_VERSION` = 0.9.0) get only their own
  athletes, as before teams: they can't tell which athletes they may change.

## Desktop

- `pullAccess` copies `AthleteShare` rows the coach is part of, and the other coaches'
  names; newly shared athletes come down whole, unshared ones go.
- Screens: Programming grid and week tabs, Competition's meet panel, and Tracking (all of
  it for view; Wellness for review) are `inert` with a note, and their palette commands
  that change things are left out. The roster card is a disabled fieldset.
- **Bounce-back:** if a change to a view/review athlete gets past the screens, `push` keeps
  it back, drops that athlete locally, and pulls it again whole on the next pull. A row
  deleted locally can't be traced to its athlete, so it stays gone until a re-pull.

## Migration from teams

`20261022090000_athlete_shares`: every teammate of a team athlete becomes an `edit` share,
then `Team`, `TeamMember` and `Athlete.teamId` go.
