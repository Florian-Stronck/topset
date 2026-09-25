# Tracking overhaul — plan

> **Status (2026-09-25):** built on `claude/tracking-overhaul`, all phases. Where it differs from the plan below:
>
> - Notes are one table, `CoachMessage`, synced as a *merged* table like weigh-ins (coach writes the text, the
>   athlete app `readAt`; newer edit wins, deletes are tombstones) — not `CoachFeedback` + an athlete-owned
>   `FeedbackRead`. It rides the existing merged-row channel, so `sync.ts` needed no change.
> - The inbox is one-way: the athlete reads, doesn't reply.
> - `LiftChart` kept its own drawing and gained controlled lift toggles and a range control; the new charts share
>   `src/components/charts/charts.tsx`.
> - The *Show accessories* toggle became *Coach notes* (cues under each exercise) — accessories are in the lift filter.
> - Refresh is automatic; the header keeps a small "Updated n min ago" that refreshes on click.
> - Not done: new screenshots in `docs/screenshots/`.

Tracking today is one long scroll of twelve sections, ordered backwards for how a coach
works (long-term chart first, session review last), with strength progress in three
places, check-ins in three, and always-open inputs on every row. This plan turns it into
three views built around what a coach does:

1. **Triage** — what changed since I last looked?
2. **Review** — plan vs done, how hard it felt, then reply to the athlete.
3. **Adjust** — are the loads right, is it time for a new 1RM?
4. **Trends** — strength, volume, compliance, readiness, bodyweight.

Decisions taken (2026-09-25):

- Three views: **Review** (default) · **Progress** · **Wellness**, as `?view=` on `/tracking`.
- Coach feedback per session goes to the athlete, who gets an **Inbox** in the athlete app.
- Coach no longer enters results on the desktop — the athlete app is the only way in.
- No "move missed session" action.
- More toggles, filters and graphs.

Every phase is one PR off `master`, with EN/DE/FR/LB strings through `t()`, the palette
commands listed under [Command palette](#command-palette) for that phase, and tests for
anything added to `src/lib`. Charts stay hand-rolled SVG like `LiftChart` — no chart library.

## Command palette

Everything a click does on Tracking, the palette does too, and every command is rebindable.
Same rules as the rest of the app:

- Each command is a `COMMAND_SPECS` entry in `src/lib/shortcuts.ts` (id, English title, group,
  optional default keys) **and** a `Command` registered with `useCommands()` by the component
  that owns it — the shell for view/phase/week commands, `ReviewView` for session commands,
  each chart for its own toggles. Registered only while that view is mounted, so the palette
  on Progress doesn't offer "Mark reviewed".
- Default keys are Alt-based (or none); nothing bare. Free today on Tracking: `alt+1..3`,
  `alt+j`, `alt+k`, `alt+o`, `alt+x`, `alt+f`, `alt+u`. (`alt+arrowup/down`, `alt+enter`, `alt+r`
  are grid-only and stay out of the way.) `shortcuts.test.ts` gets a check that no two specs share a default.
- Toggle commands say what they will do, like `track-offplan` does now
  ("Show only off-plan sets" ↔ "Show every set"), so the palette reads as the current state.
- Prefixes: `:` widens from weeks to **weeks and sessions** ("Week 3 · Fri — Squat focus"),
  `#` gains the three views, `@` keeps athletes (stepping keeps the current view and week).
- `ShortcutSheet` groups: **Tracking view**, **Session**, **Filter**, **Chart**.

| Phase | id | Title | Keys | Kind |
|---|---|---|---|---|
| 1 | `view-review` / `view-progress` / `view-wellness` | Review · Progress · Wellness | `alt+1` / `alt+2` / `alt+3` | place |
| 1 | `refresh` (exists) | Refresh what athletes logged | — | |
| 1 | `track-autosync` | Stop / start refreshing on its own | — | |
| 1 | `week-prev` / `week-next` / `week-n` (exist) | kept, move to the shell | as today | week |
| 1 | `phase-*`, `open-program-*`, `go-programming` (exist) | kept, keep the current view in the URL | as today | place |
| 2 | `session-next` / `session-prev` | Next / previous session | `alt+j` / `alt+k` | |
| 2 | `session-<dayId>` | Week n · weekday — label | — | week |
| 2 | `session-expand` | Expand / collapse the session | `alt+o` | |
| 2 | `session-expand-all` | Expand / collapse every session | — | |
| 2 | `session-videos` | Videos for this session | — | |
| 3 | `track-filter-all` / `-unreviewed` / `-offplan` / `-missed` / `-prs` | Show every session · only unreviewed · only off plan · only missed · only PRs (replaces `track-offplan`) | — | |
| 3 | `track-lifts-all` / `-primary` / `-secondary` / `-accessory` | Every exercise · competition lifts · variations · accessories | — | |
| 3 | `track-toggle-sets` / `-upcoming` / `-cues` | Expand every set · show upcoming sessions · show coach notes, tempo and rest (on/off wording) | — | |
| 3 | `track-attention` | Jump to what needs attention | — | |
| 4 | `session-review` | Mark the session reviewed / not reviewed | `alt+x` | |
| 4 | `session-feedback` | Write feedback for this session (focuses the box; `mod+enter` sends) | `alt+f` | |
| 4 | `session-next-unreviewed` | Next session to review | `alt+u` | |
| 4 | `week-review-all` | Mark the whole week reviewed | — | |
| 5 | `chart-lift-squat` / `-bench` / `-dead` | Show / hide squat · bench · deadlift | — | |
| 5 | `chart-e1rm-basis` | Chart: logged e1RM / prescribed top set (replaces `track-chart`) | — | |
| 5 | `chart-range-phase` / `-program` / `-12w` / `-all` | Chart range: phase · program · 12 weeks · all | — | |
| 5 | `chart-tonnage-by` | Tonnage by lift / by target | — | |
| 5 | `use-1rm-squat` / `-bench` / `-dead` | Use the best e1RM as the squat · bench · deadlift 1RM | — | |
| 5 | `history-<exercise>` | Exercise history: name | — | place |
| 6 | `checkins-range-14` / `-28` / `-56` | Check-ins: 14 · 28 · 56 days | — | |
| 6 | `checkins-low-only` | Only low-readiness days / every day | — | |
| 6 | `readiness-per-question` | Readiness as one score / per question | — | |
| 6 | `bodyweight-add` | Add a weigh-in (focuses the field) | — | |

`track-link` ("Check-in link for …") stays. The athlete app has no palette — it's a phone app.

---

## Phase 1 — Three views, reorder, cut the noise (no schema)

Split `TrackingSheet.tsx` (769 lines) into a shell and three views.

- `src/app/tracking/page.tsx`: read `view` from `searchParams` (`review` default); only load
  what the view needs (`exerciseHistory` / `liftProgress` for Progress, check-ins and
  bodyweight for Wellness).
- `src/components/tracking/TrackingShell.tsx`: header (athlete stepper, program + phase
  pickers, "synced n min ago"), view tabs, shared commands.
- `src/components/tracking/ReviewView.tsx`: week tiles + session cards (days as today, restyled in Phase 2).
- `src/components/tracking/ProgressView.tsx`: `LiftChart`, best-e1RM cards, `ExerciseHistoryPanel`, `VolumeTable`.
- `src/components/tracking/WellnessView.tsx`: `CheckinPanel`, `BodyweightPanel`.
- Delete `TrackingSheet.tsx` once moved.

Remove:

- Subtitle "what was actually lifted against what was prescribed".
- `WeekCheckins` strip (weekly + off-day answers move to Wellness; day answers stay in the session header).
- All result inputs: `NumberInput` for Logged / RPE, `TextInput` for athlete notes, the `patch()` path.
  Keep `actualWeight`/`performedRpe` in sync and exports — only the UI goes.
- The Refresh button: auto-sync every 60 s while the tab is visible and on window focus;
  "Refresh what athletes logged" stays as a palette command.

Commands: `view-review`, `view-progress`, `view-wellness` (group "View").

Done when: each view renders on its own URL, nothing on the old page is lost except the
removed items, `npm test` and `tsc` pass.

## Phase 2 — Compact exercise lines (Review)

New in `src/lib/tracking.ts` (pure, tested in `src/lib/tracking.test.ts`):

- `rowSummary(row, target, unit)` → `{ plan: "4×5 @8 · 177.5", done: { weight, reps[], efforts[] } | null, e1rm, topSet }`.
- `previousOf(row, block)` → the same exercise last week via the `fromId` chain, with its top set and e1RM;
  falls back to the last matching exercise name in earlier phases.
- `deviation(row, target, past)` → chips from `offPlan` ("10% under", "RPE +1.5", "not done").

UI (`src/components/tracking/SessionCard.tsx`, `ExerciseLine.tsx`):

- Card header: status dot (reuse `dayStatus` from `compliance.ts`), label, date, `n/m exercises`,
  readiness chip with answers in the tooltip.
- One line per exercise: name + PR badge · `plan → weight × reps @efforts` · e1RM with Δ vs last week · deviation chip.
- Click expands: set table, "last week" line, coach notes / tempo / rest (from the row),
  athlete note (read-only), videos. The video drop zone only shows when expanded or while dragging a file.
- Week tiles replace the tab strip: week n, % sets done, one dot per session.

## Phase 3 — Filters, toggles, attention bar (Review)

- Attention bar above the weeks: chips for **Unreviewed · Missed · Off plan · PRs · Low readiness**
  with counts for the open week; click one to apply it as a filter.
- Filters (segmented): **All · Unreviewed · Off plan · Missed · PRs**.
- Lift filter: **All · Competition lifts (PRIMARY) · Variations (SECONDARY) · Accessories**, from `row.tier`.
- Toggles: *Expand all sets*, *Show upcoming sessions*, *Show accessories*.
- Filter and toggle state lives in `src/lib/prefs.ts` (per computer, `topset:` keys);
  the active filter also goes in the URL (`?show=offplan`) so an Overview flag can link straight to it.
- Replaces the "Off-plan only" checkbox and the `track-offplan` command
  (becomes `track-filter-*` commands, one per filter).

"Unreviewed" needs Phase 4; until it lands, the chip and the filter are hidden.

## Phase 4 — Coach feedback, reviewed state, athlete inbox

Schema (migration in `prisma/migrations/`; `dev.db` is `db push` built, so test the migration on a copy):

```prisma
model Day {
  // …
  /// When the coach last marked this session reviewed. Coach-owned.
  reviewedAt DateTime?
}

/// A message from the coach to the athlete about one session. Coach-owned: syncs up like the plan.
model CoachFeedback {
  id        String   @id @default(cuid())
  athleteId String
  athlete   Athlete  @relation(fields: [athleteId], references: [id], onDelete: Cascade)
  dayId     String?
  day       Day?     @relation(fields: [dayId], references: [id], onDelete: SetNull)
  rowId     String?  /// set when the note is about one exercise
  body      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  reads     FeedbackRead[]
  @@index([athleteId, createdAt])
}

/// The athlete opened a message. Athlete-owned: syncs down like SetLog.
model FeedbackRead {
  feedbackId String        @id
  feedback   CoachFeedback @relation(fields: [feedbackId], references: [id], onDelete: Cascade)
  readAt     DateTime      @default(now())
}
```

Sync (`src/lib/sync-plan.ts`, `sync.ts`, `sync-server.ts`):

- `CoachFeedback` is coach-owned — picked up by the generic table push; add it to `ORDER` after `Day`.
- `FeedbackRead` joins `ATHLETE_TABLES`. `sync.ts:219` and `sync-server.ts:86` name `SetLog`
  directly — generalise both to loop over `ATHLETE_TABLES`, with ownership checked through
  `CoachFeedback.athleteId`. Tests in `sync-plan.test.ts` / `sync-server.test.ts`.

Coach side (`src/app/tracking/actions.ts`, each starting with `assertCoach()`):

- `sendFeedback(dayId, body, rowId?)` → creates the message and sets `Day.reviewedAt = now`.
- `markReviewed(dayId, reviewed: boolean)`, `editFeedback(id, body)`, `deleteFeedback(id)`.
- Session card: feedback box + "Send and mark reviewed" (Ctrl+Enter), "Mark reviewed" without a message,
  sent messages listed under the card with "read" once a `FeedbackRead` exists.
- "Unreviewed" = the session has a done set or a check-in answer newer than `reviewedAt`
  (`SetLog.loggedAt`, `CheckinAnswer.updatedAt`). Pure helper `needsReview()` in `tracking.ts`, tested.
- Overview: add an "n sessions to review" flag (`trainingFlags`, action `review`) linking to
  `/tracking?athlete=…&show=unreviewed`.

Athlete side:

- `src/app/a/[token]/inbox/page.tsx`: messages newest first, grouped by session, each linking to
  that day in History; unread ones highlighted, marked read on open (server action in `src/app/a/actions.ts`).
- `AthleteNav`: fourth tab **Inbox** with an unread count badge.
- Today and History: the session's feedback shown under it.
- Athlete query helpers in `src/lib/athlete-queries.ts`.

## Phase 5 — Progress view and graphs

Shared SVG primitives in `src/components/charts/` (`LineChart`, `BarChart`, `Legend`, hover tooltip),
refactoring `LiftChart` onto them.

Top: e1RM tiles per lift (best this phase, Δ vs 1RM on file, "Use as 1RM" as today).

Graphs, each with its own toggles:

1. **Estimated 1RM trend** — lines per lift; toggles: lifts on/off, *Logged e1RM* (default) / *Prescribed top set*,
   range *Phase · Program · 12 weeks · All*.
2. **Weekly tonnage** — stacked bars per lift (or per target); toggle *By lift / By target*.
3. **RPE vs plan** — per week, prescribed RPE vs logged RPE per lift; the gap shaded.
4. **Compliance** — % sets done per week, bars, with missed sessions marked.
5. **Intensity zones** — sets per week in %1RM bands (<70, 70–80, 80–90, 90+), stacked; toggle per lift.
6. **Per-lift week table** — week, top set, e1RM, RPE vs plan, sets done, tonnage; lift picker.
7. `ExerciseHistoryPanel` and `VolumeTable` stay below, unchanged.

New pure helpers in `src/lib/progress.ts` / `src/lib/volume.ts` (`weeklyTonnage`, `rpeByWeek`,
`intensityZones`, `liftWeekTable`), tested. Toggles persist in `prefs.ts`.

## Phase 6 — Wellness view and graphs

1. **Readiness trend** — daily bars 14/28/56 days, low days marked; toggle to show each scale question as its own line.
2. **Readiness vs RPE drift** — readiness bars with the session's RPE drift overlaid, so "felt heavy because slept 4 h" reads at a glance.
3. **Bodyweight** — the existing panel's line with the class limit, 7-day average and projected meet-day weight.
4. Check-ins table (existing `CheckinPanel`) below, with a *Only low days* filter.

## Phase 7 — Wrap-up

- Tutorial steps for Tracking (`Tutorial.tsx`) rewritten for the three views.
- `ShortcutSheet` / command list updated.
- New `docs/screenshots/tracking.png` (plus progress and wellness), README section.
- Version bump.

## Order and size

| Phase | Depends on | Size |
|---|---|---|
| 1 Views + cuts | — | M |
| 2 Exercise lines | 1 | M |
| 3 Filters + attention | 2 (Unreviewed after 4) | S |
| 4 Feedback + inbox | 1 | L — schema, sync, athlete app |
| 5 Progress graphs | 1 | L |
| 6 Wellness graphs | 1, charts from 5 | M |
| 7 Wrap-up | all | S |

Phases 4 and 5 can run in parallel once 1 is in.
