"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { IntensityType, MeetLift, Tier } from "@prisma/client";
import { checkBackupFolder, resetSetting, updateAccount } from "@/app/settings/actions";
import {
  accountStatus,
  changePassword,
  createAccount,
  createInvite,
  deleteInvite,
  deleteMyAccount,
  listCoaches,
  manageCoach,
  resetPassword,
  signedInComputers,
  signIn,
  signOut,
  signOutOtherComputers,
  syncEverything,
  type AccountStatus,
  type CoachListing,
  type InviteListing,
} from "@/app/settings/cloud-actions";
import { useSettings } from "@/components/SettingsProvider";
import { EXERCISE_CATALOG } from "@/lib/exercises";
import { LANGUAGES, plural, t, weekdayShort } from "@/lib/i18n";
import { pickFile, restoreBackup, type RestoreStatus } from "@/lib/pick-file";
import { colorOfTarget, PREF_DEFAULTS, resetPref, setPref, usePref, type Column } from "@/lib/prefs";
import {
  activeSettings,
  DEFAULTS,
  TIERS,
  tierLabel,
  type CoachSettings,
  type CustomExercise,
  type ProgressionPreset,
  type SettingsPatch,
} from "@/lib/settings";
import { KeybindingsEditor } from "@/components/KeybindingsEditor";
import { SETTINGS_SECTIONS as SECTIONS } from "@/lib/settings-sections";
import { SPEC_BY_ID } from "@/lib/shortcuts";
import { WEEKDAYS } from "@/lib/types";


/**
 * Everything the coach can set, in one page. Most of it travels with their data; the
 * sections marked "this computer" only change how Topset looks here.
 */
export function SettingsView({ coachName }: { coachName: string }) {
  const { settings, update, saving } = useSettings();
  // The Coaches page is the admin's alone.
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    accountStatus().then((s) => live && setAdmin(Boolean(s.signedIn?.isAdmin)));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-[1100px] gap-8 px-6 py-7">
      <nav className="sticky top-7 hidden h-fit w-[190px] shrink-0 lg:block">
        <h1 className="text-[22px] font-semibold tracking-tight">{t("Settings")}</h1>
        <ul className="mt-5 space-y-0.5">
          {SECTIONS.filter((s) => !("admin" in s) || admin).map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="block rounded-md px-2 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-foreground"
              >
                {t(s.title)}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-4 px-2 text-[11px] text-muted-2">{saving ? t("Saving…") : t("Changes save by themselves.")}</p>
      </nav>

      <div className="min-w-0 flex-1 pb-24">
        <h1 className="text-[22px] font-semibold tracking-tight lg:hidden">{t("Settings")}</h1>
        <Account name={coachName} />
        <Units settings={settings} update={update} />
        <Programming settings={settings} update={update} />
        <Calendar settings={settings} update={update} />
        <Exercises settings={settings} update={update} />
        <View />
        <Keyboard />
        <Exports settings={settings} update={update} />
        <Tracking settings={settings} update={update} />
        <AthleteApp settings={settings} update={update} />
        <SignInSecurity />
        {admin && <Coaches />}
        <Data settings={settings} update={update} />
        <App settings={settings} update={update} />
      </div>
    </div>
  );
}

type Props = { settings: CoachSettings; update: (patch: SettingsPatch) => void };

// ---------------------------------------------------------------------------------------
// Sections

function Account({ name }: { name: string }) {
  const [, startTransition] = useTransition();
  const save = (patch: { name?: string }) =>
    startTransition(async () => {
      await updateAccount(patch);
    });

  return (
    <Section id="account" title="Account" hint="Shown in the sidebar and, if you like, on exports.">
      <Row label="Name">
        <TextField value={name} onCommit={(v) => save({ name: v })} width={220} />
      </Row>
    </Section>
  );
}

function Units({ settings, update }: Props) {
  return (
    <Section id="units" title="Units and numbers">
      <Row label="Unit for new athletes">
        <Select
          value={settings.defaultUnit}
          options={[
            ["KG", "kg"],
            ["LB", "lb"],
          ]}
          onChange={(v) => update({ defaultUnit: v as CoachSettings["defaultUnit"] })}
        />
      </Row>
      <Row label="Round kg loads to" hint="Every calculated weight snaps to this step.">
        <Select
          value={String(settings.roundKg)}
          options={["0.5", "1", "1.25", "2.5", "5"].map((v) => [v, `${v} kg`])}
          onChange={(v) => update({ roundKg: Number(v) })}
        />
      </Row>
      <Row label="Round lb loads to">
        <Select
          value={String(settings.roundLb)}
          options={["1", "2.5", "5", "10"].map((v) => [v, `${v} lb`])}
          onChange={(v) => update({ roundLb: Number(v) })}
        />
      </Row>
      <Row label="Estimated 1RM from" hint="How a logged set becomes an estimated max in Tracking.">
        <Select
          value={settings.e1rmFormula}
          options={[
            ["rpe", t("RPE chart")],
            ["epley", "Epley"],
            ["brzycki", "Brzycki"],
          ]}
          onChange={(v) => update({ e1rmFormula: v as CoachSettings["e1rmFormula"] })}
        />
      </Row>
      <Row label="Decimals for % and RPE">
        <Select
          value={String(settings.decimals)}
          options={["0", "1", "2"].map((v) => [v, v])}
          onChange={(v) => update({ decimals: Number(v) })}
        />
      </Row>
      <Row
        label="RPE chart"
        hint="% of 1RM for each RPE and rep count. RPE loads come off this; anything off the chart is read along the same curve."
        stacked
        action={<ResetLink onClick={() => update({ rpeTable: DEFAULTS.rpeTable })} />}
      >
        <RpeChart table={settings.rpeTable} onChange={(rpeTable) => update({ rpeTable })} />
      </Row>
    </Section>
  );
}

function Programming({ settings, update }: Props) {
  const tierColors = usePref("tierColors");
  const row = settings.newRow;
  const setRow = (patch: Partial<CoachSettings["newRow"]>) => update({ newRow: { ...row, ...patch } });

  return (
    <Section id="programming" title="Programming defaults">
      <Row label="A new row starts as" stacked>
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            value={row.tier}
            options={TIERS.map((tier) => [tier, tierLabel(tier)])}
            onChange={(v) => setRow({ tier: v as Tier })}
          />
          <TextField value={row.target} onCommit={(v) => setRow({ target: v || "General" })} width={120} list="settings-targets" />
          <NumberField value={row.sets} onCommit={(v) => setRow({ sets: v ?? 3 })} width={52} suffix={t("sets")} />
          <NumberField value={row.reps} onCommit={(v) => setRow({ reps: v ?? 8 })} width={52} suffix={t("reps")} />
          <Select
            value={row.intensityType}
            options={(["RPE", "RIR", "PERCENT", "WEIGHT"] as IntensityType[]).map((v) => [v, v === "PERCENT" ? "%" : v === "WEIGHT" ? t("Weight") : v])}
            onChange={(v) => setRow({ intensityType: v as IntensityType })}
          />
          <NumberField value={row.intensity} step={0.5} onCommit={(v) => setRow({ intensity: v ?? 7 })} width={60} />
        </div>
        <datalist id="settings-targets">
          {settings.targets.map((target) => (
            <option key={target} value={target} />
          ))}
        </datalist>
      </Row>
      <Row
        label="Keep every week the same"
        hint="An edit in one week is made in all the other weeks of the phase — before and after it. Locked weeks keep their own, and rule-driven sets, reps and intensity still follow their rules."
      >
        <Switch on={settings.syncWeeks} onChange={(v) => update({ syncWeeks: v })} />
      </Row>
      <Row label="Weeks in a new program">
        <NumberField value={settings.programWeeks} min={1} max={52} onCommit={(v) => update({ programWeeks: v ?? 4 })} width={60} />
      </Row>
      <Row label="Weeks in a new phase">
        <NumberField value={settings.phaseWeeks} min={1} max={52} onCommit={(v) => update({ phaseWeeks: v ?? 4 })} width={60} />
      </Row>
      <Row label="Phase names, in order" hint="The first phase gets the first name, the next the second, and so on." stacked>
        <TagList values={settings.phaseNames} onChange={(v) => update({ phaseNames: v })} placeholder={t("Add a phase name")} />
      </Row>
      <Row label="Training days in a new program" stacked>
        <div className="flex flex-wrap gap-1">
          {WEEKDAYS.map((day, i) => {
            const on = settings.trainingDays.includes(i);
            return (
              <button
                key={day}
                type="button"
                onClick={() =>
                  update({
                    trainingDays: on
                      ? settings.trainingDays.filter((d) => d !== i)
                      : [...settings.trainingDays, i].sort((a, b) => a - b),
                  })
                }
                className={`rounded-md border px-2.5 py-1 text-[12px] ${
                  on ? "border-accent/60 bg-accent-soft text-accent" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {weekdayShort(i)}
              </button>
            );
          })}
        </div>
      </Row>
      <Row label="Name training days">
        <Select
          value={settings.dayNaming}
          options={[
            ["session", t("Session 1, Session 2…")],
            ["day", t("Day 1, Day 2…")],
            ["weekday", t("Monday, Wednesday…")],
          ]}
          onChange={(v) => update({ dayNaming: v as CoachSettings["dayNaming"] })}
        />
      </Row>
      <Row label="Call rest days">
        <TextField value={settings.restName} onCommit={(v) => update({ restName: v || "Rest" })} width={140} />
      </Row>
      <Row label="Tiers" hint="Rename them, choose which the tier menu offers, and pick their colour on this computer." stacked>
        <div className="space-y-1.5">
          {TIERS.map((tier) => (
            <div key={tier} className="flex items-center gap-2">
              <input
                type="color"
                value={tierColors[tier]}
                onChange={(e) => setPref("tierColors", { ...tierColors, [tier]: e.target.value })}
                className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent"
                title={t("Colour on this computer")}
              />
              <TextField
                value={settings.tiers[tier].label}
                onCommit={(v) => update({ tiers: { ...settings.tiers, [tier]: { ...settings.tiers[tier], label: v || DEFAULTS.tiers[tier].label } } })}
                width={160}
              />
              <Switch
                on={settings.tiers[tier].show}
                onChange={(show) => update({ tiers: { ...settings.tiers, [tier]: { ...settings.tiers[tier], show } } })}
              />
              <span className="text-[11px] text-muted-2">{settings.tiers[tier].show ? t("offered") : t("hidden")}</span>
            </div>
          ))}
        </div>
      </Row>
      <Row label="Targets" hint="Suggested in the TARGET column. Squat, Bench and Deadlift are what 1RMs are read from." stacked>
        <TagList values={settings.targets} onChange={(v) => update({ targets: v })} placeholder={t("Add a target")} />
      </Row>
      <Row
        label="Target colours"
        hint="Rows for a coloured target are tinted and badged with it on the sheet, on this computer."
        stacked
        action={<ResetLink onClick={() => setPref("targetColors", PREF_DEFAULTS.targetColors)} />}
      >
        <TargetColors targets={settings.targets} />
      </Row>
      <Row
        label="Progression presets"
        hint="The one-click rules in a row's progression menu."
        stacked
        action={<ResetLink onClick={() => update({ progressionPresets: DEFAULTS.progressionPresets })} />}
      >
        <PresetEditor presets={settings.progressionPresets} onChange={(v) => update({ progressionPresets: v })} />
      </Row>
    </Section>
  );
}

function Calendar({ settings, update }: Props) {
  return (
    <Section id="calendar" title="Calendar and dates">
      <Row label="First day of the week">
        <Select
          value={String(settings.weekStart)}
          options={WEEKDAYS.map((d, i) => [String(i), t(d)])}
          onChange={(v) => update({ weekStart: Number(v) })}
        />
      </Row>
      <Row label="Programs and phases start on it" hint="Off: they start on exactly the date you pick.">
        <Switch on={settings.snapStart} onChange={(v) => update({ snapStart: v })} />
      </Row>
      <Row label="Date format">
        <Select
          value={settings.dateFormat}
          options={[
            ["d-mmm", "21 Sept"],
            ["dd/mm", "21/09"],
            ["mm/dd", "09/21"],
          ]}
          onChange={(v) => update({ dateFormat: v as CoachSettings["dateFormat"] })}
        />
      </Row>
    </Section>
  );
}

function Exercises({ settings, update }: Props) {
  const [query, setQuery] = useState("");
  const custom = settings.customExercises;
  const setCustom = (list: CustomExercise[]) => update({ customExercises: list });
  const hidden = new Set(settings.hiddenExercises.map((n) => n.toLowerCase()));
  const builtIns = EXERCISE_CATALOG.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Section id="exercises" title="Exercises">
      <Row
        label="Your exercises"
        hint="Added to the suggestions. The target decides which 1RM a lift is worked out from; one with a built-in's name replaces it. Aliases are other names you type for it."
        stacked
      >
        <div className="space-y-1.5">
          {custom.map((e, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <TextField value={e.name} placeholder={t("Name")} width={170} onCommit={(v) => setCustom(custom.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
              <TextField value={e.target} placeholder={t("Target")} width={110} list="settings-targets" onCommit={(v) => setCustom(custom.map((x, j) => (j === i ? { ...x, target: v || "General" } : x)))} />
              <Select value={e.tier} options={TIERS.map((tier) => [tier, tierLabel(tier)])} onChange={(v) => setCustom(custom.map((x, j) => (j === i ? { ...x, tier: v as Tier } : x)))} />
              <TextField
                value={e.aliases.join(", ")}
                placeholder={t("Aliases, comma separated")}
                width={180}
                onCommit={(v) =>
                  setCustom(custom.map((x, j) => (j === i ? { ...x, aliases: v.split(",").map((a) => a.trim()).filter(Boolean) } : x)))
                }
              />
              <button type="button" onClick={() => setCustom(custom.filter((_, j) => j !== i))} className="px-1 text-[13px] text-muted-2 hover:text-accent" title={t("Remove")}>
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setCustom([...custom, { name: "", target: "General", tier: "ACCESSORY", aliases: [] }])}
            className="rounded border border-dashed border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent"
          >
            + {t("Add exercise")}
          </button>
        </div>
      </Row>
      <Row label="Built-in exercises" hint="Hide the ones you never use from the suggestions." stacked>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search")}
          className="mb-2 w-[220px] rounded border border-border bg-background px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-accent/60"
        />
        <div className="grid max-h-[260px] grid-cols-1 gap-x-4 overflow-auto sm:grid-cols-2">
          {builtIns.map((e) => {
            const off = hidden.has(e.name.toLowerCase());
            return (
              <label key={e.name} className="flex cursor-pointer items-center gap-2 py-0.5 text-[12px]">
                <input
                  type="checkbox"
                  checked={!off}
                  onChange={() =>
                    update({
                      hiddenExercises: off
                        ? settings.hiddenExercises.filter((n) => n.toLowerCase() !== e.name.toLowerCase())
                        : [...settings.hiddenExercises, e.name],
                    })
                  }
                  className="accent-[color:var(--accent)]"
                />
                <span className={off ? "text-muted-2 line-through" : ""}>{e.name}</span>
                <span className="text-[11px] text-muted-2">{e.target}</span>
              </label>
            );
          })}
        </div>
      </Row>
    </Section>
  );
}

function View() {
  const tight = usePref("tightIntensity");
  const density = usePref("density");
  const columns = usePref("columns");
  const hideRest = usePref("hideRestDays");
  const cellDisplay = usePref("cellDisplay");
  const fontSize = usePref("fontSize");
  const theme = usePref("theme");
  const accent = usePref("accent");

  const COLUMN_LABEL: Record<Column, string> = {
    progression: "Progression",
    notes: "Coach notes",
    tempo: "Tempo",
    rest: "Rest time",
    video: "Video link",
  };

  return (
    <Section id="view" title="Grid and view" local>
      <Row label="Keep intensity beside reps" hint="Coach notes take the extra width instead.">
        <Switch on={tight} onChange={(v) => setPref("tightIntensity", v)} />
      </Row>
      <Row label="Row spacing">
        <Select
          value={density}
          options={[
            ["comfortable", t("Comfortable")],
            ["compact", t("Compact")],
          ]}
          onChange={(v) => setPref("density", v as typeof density)}
        />
      </Row>
      <Row label="Columns" stacked>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(COLUMN_LABEL) as Column[]).map((c) => (
            <label key={c} className="flex items-center gap-2 text-[12px]">
              <Switch on={columns[c]} onChange={(v) => setPref("columns", { ...columns, [c]: v })} />
              {t(COLUMN_LABEL[c])}
            </label>
          ))}
        </div>
      </Row>
      <Row label="Hide rest days" hint="A strip of the week's days stays on top; click a rest day there to train on it.">
        <Switch on={hideRest} onChange={(v) => setPref("hideRestDays", v)} />
      </Row>
      <Row label="Intensity cell shows">
        <Select
          value={cellDisplay}
          options={[
            ["both", t("Weight and prescription")],
            ["weight", t("Weight only")],
            ["intensity", t("Prescription only")],
          ]}
          onChange={(v) => setPref("cellDisplay", v as typeof cellDisplay)}
        />
      </Row>
      <Row label="Text size">
        <Select
          value={fontSize}
          options={[
            ["small", t("Small")],
            ["medium", t("Medium")],
            ["large", t("Large")],
          ]}
          onChange={(v) => setPref("fontSize", v as typeof fontSize)}
        />
      </Row>
      <Row label="Theme">
        <Select
          value={theme}
          options={[
            ["dark", t("Dark")],
            ["light", t("Light")],
            ["system", t("Match system")],
          ]}
          onChange={(v) => setPref("theme", v as typeof theme)}
        />
      </Row>
      <Row label="Accent colour" action={accent !== PREF_DEFAULTS.accent ? <ResetLink onClick={() => resetPref("accent")} /> : undefined}>
        <input
          type="color"
          value={accent}
          onChange={(e) => setPref("accent", e.target.value)}
          className="h-7 w-12 cursor-pointer rounded border border-border bg-transparent"
        />
      </Row>
    </Section>
  );
}

function Keyboard() {
  const pinned = usePref("pinnedCommands");
  const titles = usePref("keybindingTitles");
  const titleOf = (id: string) => {
    const spec = SPEC_BY_ID.get(id);
    return spec ? t(spec.title) : (titles[id] ?? id);
  };

  return (
    <Section
      id="keyboard"
      title="Keyboard"
      local
      hint="Every command in the Ctrl+K palette can take a key, or a two-key chord. Click + and press the keys; Esc cancels. Keys without Ctrl or Alt only work outside the cells."
    >
      <KeybindingsEditor />
      <Row label="Pinned commands" hint="Pin with the ☆ next to any command in the Ctrl+K palette." stacked>
        {pinned.length === 0 ? (
          <span className="text-[12px] text-muted-2">{t("None yet.")}</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {pinned.map((id) => (
              <span key={id} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px]">
                {titleOf(id)}
                <button type="button" onClick={() => setPref("pinnedCommands", pinned.filter((p) => p !== id))} className="text-muted-2 hover:text-accent">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </Row>
    </Section>
  );
}

function Exports({ settings, update }: Props) {
  const b = settings.branding;
  const setBrand = (patch: Partial<CoachSettings["branding"]>) => update({ branding: { ...b, ...patch } });
  const [logoError, setLogoError] = useState<string | null>(null);
  // Bumped after every upload, so the preview doesn't show the old image from cache.
  const [logoVersion, setLogoVersion] = useState(0);
  const router = useRouter();
  const cols = settings.exportColumns;

  /** Uploads straight to /api/logo — the image never travels with the settings. */
  async function chooseLogo() {
    const file = await pickFile("image/png,image/jpeg");
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setLogoError(t("Pick an image under 2 MB."));
    const res = await fetch("/api/logo", { method: "POST", headers: { "Content-Type": file.type }, body: file });
    const body = (await res.json()) as { ok: boolean; error?: string };
    if (!body.ok) return setLogoError(t(body.error ?? "Upload failed."));
    setLogoError(null);
    setLogoVersion(Date.now());
    router.refresh();
  }

  async function removeLogo() {
    await fetch("/api/logo", { method: "DELETE" });
    setLogoVersion(Date.now());
    router.refresh();
  }

  return (
    <Section id="exports" title="Exports and print">
      <Row label="Name on exports" hint="Your name or your team's, on every PDF and print, and on the spreadsheet's start page.">
        <TextField value={b.name} onCommit={(v) => setBrand({ name: v })} width={220} placeholder={t("e.g. Iron Coaching")} />
      </Row>
      <Row label="Logo" hint={logoError ?? t("PNG or JPEG, up to 2 MB.")} warn={logoError !== null}>
        <div className="flex items-center gap-2">
          {b.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/logo?v=${logoVersion}`} alt="" className="h-10 max-w-[140px] rounded border border-border bg-white object-contain" />
          )}
          <button type="button" onClick={chooseLogo} className="rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent">
            {b.logo ? t("Change…") : t("Choose…")}
          </button>
          {b.logo && (
            <button type="button" onClick={removeLogo} className="text-[12px] text-muted-2 hover:text-accent">
              {t("Remove")}
            </button>
          )}
        </div>
      </Row>
      <Row label="Header line" hint="Under your name on PDFs and prints, e.g. contact details.">
        <TextField value={b.header} onCommit={(v) => setBrand({ header: v })} width={300} />
      </Row>
      <Row label="Footer line" hint="At the bottom of every PDF and printed page, e.g. a disclaimer.">
        <TextField value={b.footer} onCommit={(v) => setBrand({ footer: v })} width={300} />
      </Row>
      <Row label="Columns in exports" stacked>
        <div className="flex flex-wrap gap-3">
          {(
            [
              ["notes", "Coach notes"],
              ["tempo", "Tempo"],
              ["rest", "Rest time"],
              ["video", "Video link"],
            ] as const
          ).map(([key, name]) => (
            <label key={key} className="flex items-center gap-2 text-[12px]">
              <Switch on={cols[key]} onChange={(v) => update({ exportColumns: { ...cols, [key]: v } })} />
              {t(name)}
            </label>
          ))}
        </div>
      </Row>
      <Row label="Paper">
        <div className="flex gap-1.5">
          <Select
            value={settings.paper}
            options={[
              ["A4", "A4"],
              ["LETTER", "Letter"],
            ]}
            onChange={(v) => update({ paper: v as CoachSettings["paper"] })}
          />
          <Select
            value={settings.orientation}
            options={[
              ["portrait", t("Portrait")],
              ["landscape", t("Landscape")],
            ]}
            onChange={(v) => update({ orientation: v as CoachSettings["orientation"] })}
          />
        </div>
      </Row>
      <Row label="Logging boxes per set" hint="On the print sheet: 1 for the weight, 2 for weight and reps, 3 adds RPE. 0 leaves the column blank.">
        <Select value={String(settings.logBoxes)} options={["0", "1", "2", "3", "4"].map((v) => [v, v])} onChange={(v) => update({ logBoxes: Number(v) })} />
      </Row>
      <Row label="Default export" hint="Shown first in the Export menu.">
        <Select
          value={settings.defaultExport}
          options={[
            ["xlsx", t("Whole program .xlsx")],
            ["pdf", t("Phone .pdf")],
            ["print", t("Print this phase")],
            ["csv", ".csv"],
            ["repwise", "Repwise .xlsx"],
            ["repwise-tsv", "Repwise .tsv"],
          ]}
          onChange={(v) => update({ defaultExport: v as CoachSettings["defaultExport"] })}
        />
      </Row>
      <Row label="File names" hint="{athlete}, {program}, {phase} and {date} are filled in.">
        <TextField value={settings.fileName} onCommit={(v) => update({ fileName: v || DEFAULTS.fileName })} width={300} />
      </Row>
    </Section>
  );
}

function Tracking({ settings, update }: Props) {
  const LIFTS: [MeetLift, string][] = [
    ["SQUAT", "Squat"],
    ["BENCH", "Bench"],
    ["DEADLIFT", "Deadlift"],
  ];
  return (
    <Section id="tracking" title="Tracking and competition">
      <Row label="Lifts in the total" hint="E.g. bench only, for bench meets.">
        <div className="flex gap-3">
          {LIFTS.map(([lift, name]) => {
            const on = settings.totalLifts.includes(lift);
            return (
              <label key={lift} className="flex items-center gap-2 text-[12px]">
                <Switch
                  on={on}
                  onChange={(v) =>
                    update({
                      totalLifts: v
                        ? LIFTS.map(([l]) => l).filter((l) => l === lift || settings.totalLifts.includes(l))
                        : settings.totalLifts.filter((l) => l !== lift),
                    })
                  }
                />
                {t(name)}
              </label>
            );
          })}
        </div>
      </Row>
      <Row label="Attempt plan, % of 1RM" hint="Suggested opener, second and third.">
        <div className="flex gap-1.5">
          {([1, 2, 3] as const).map((n) => (
            <NumberField
              key={n}
              value={Math.round(settings.attemptShare[n] * 1000) / 10}
              step={0.5}
              width={64}
              suffix="%"
              onCommit={(v) => update({ attemptShare: { ...settings.attemptShare, [n]: (v ?? DEFAULTS.attemptShare[n] * 100) / 100 } })}
            />
          ))}
        </div>
      </Row>
      <Row label="A PR is">
        <Select
          value={settings.pr.basis}
          options={[
            ["e1rm", t("An estimated 1RM above the one on file")],
            ["weight", t("A weight lifted above the 1RM on file")],
          ]}
          onChange={(v) => update({ pr: { ...settings.pr, basis: v as CoachSettings["pr"]["basis"] } })}
        />
      </Row>
      <Row label="Highlight PRs">
        <Switch on={settings.pr.highlight} onChange={(v) => update({ pr: { ...settings.pr, highlight: v } })} />
      </Row>
      <Row label="Flag “needs a new program”" hint="On the Overview, this many weeks before a program ends.">
        <NumberField value={settings.needsProgramWeeks} min={0} max={12} width={60} suffix={t("weeks")} onCommit={(v) => update({ needsProgramWeeks: v ?? 2 })} />
      </Row>
    </Section>
  );
}

/**
 * The coach's account on the Topset server: signing in makes this computer sync its athletes
 * there, where their athletes check in. The admin also invites other coaches here.
 */
function AthleteApp({ settings, update }: Props) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [mode, setMode] = useState<"signin" | "create" | "reset">("signin");
  const [server, setServer] = useState(settings.athleteAppUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    const load = () => accountStatus().then((s) => live && setStatus(s));
    load();
    // Keeps "last synced" moving while the page is open.
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setNote(result);
      if (result.ok) setPassword("");
      setStatus(await accountStatus());
    });
  }

  const signedIn = status?.signedIn ?? null;
  const syncLine = !signedIn
    ? null
    : status?.syncError
      ? t("Can't reach the server right now; your changes are safe here and go up once it's back. ({error})", {
          error: status.syncError,
        })
      : status?.lastSync
        ? t("Your changes go up within seconds and athletes' sets come down on their own. Last synced {time}.", {
            time: new Date(status.lastSync).toLocaleTimeString(),
          })
        : t("Syncing…");

  return (
    <Section
      id="athlete-app"
      title="Account and athlete app"
      hint="Sign in to your Topset server to give athletes their check-in links. You keep working on this computer; your athletes sync in the background. Every coach only ever sees their own athletes."
    >
      {status && !status.canSignIn ? (
        <Row label="Account" hint="Signing in works in the desktop app.">
          <span className="text-[12px] text-muted">{t("This computer only")}</span>
        </Row>
      ) : signedIn ? (
        <>
          <Row label="Signed in" hint={syncLine ?? undefined} warn={Boolean(status?.syncError)}>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted">
                {signedIn.username}
                {signedIn.isAdmin && ` · ${t("admin")}`}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(syncEverything)}
                className="rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent"
              >
                {t("Sync now")}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(t("Sign out? Your data stays on this computer; it just stops syncing."))) run(signOut);
                }}
                className="rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent"
              >
                {t("Sign out")}
              </button>
            </div>
          </Row>
          <Row label="Athlete app address" hint="Every athlete link starts with it. It's the same site you signed in to.">
            <TextField
              value={settings.athleteAppUrl}
              placeholder="https://topset-yourname.vercel.app"
              width={260}
              onCommit={(v) => update({ athleteAppUrl: v.replace(/\/+$/, "") })}
            />
          </Row>
          {note && (
            <Row label="" hint={t(note.message)} warn={!note.ok}>
              <span />
            </Row>
          )}
        </>
      ) : (
        <Row
          label={mode === "signin" ? "Sign in" : mode === "reset" ? "New password" : "Create account"}
          stacked
          hint={
            note
              ? t(note.message)
              : mode === "signin"
                ? "The server address comes from your admin, e.g. https://topset-yourname.vercel.app."
                : mode === "reset"
                  ? "Your admin makes a reset code in Settings → Coaches. Enter it with a new password of at least 8 characters. The admin uses the server's setup code (TOPSET_ADMIN_SETUP_CODE in the hosting settings) and can leave the username empty if it's forgotten too."
                  : "You need an invite code from your admin. Setting up the server yourself? Use its setup code."
          }
          warn={note?.ok === false}
        >
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() =>
                mode === "signin"
                  ? signIn({ server, username, password })
                  : mode === "reset"
                    ? resetPassword({ server, username, code, password })
                    : createAccount({ server, username, password, name, code }),
              );
            }}
          >
            <input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="https://topset-yourname.vercel.app"
              className={`${fieldClass} w-[240px]`}
            />
            <input
              value={username}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("Username")}
              className={`${fieldClass} w-[190px]`}
            />
            <input
              value={password}
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "reset" ? t("New password") : t("Password")}
              className={`${fieldClass} w-[150px]`}
            />
            {mode === "reset" && (
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t("Reset code")}
                className={`${fieldClass} w-[130px] uppercase`}
              />
            )}
            {mode === "create" && (
              <>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("Your name")}
                  className={`${fieldClass} w-[150px]`}
                />
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t("Invite code")}
                  className={`${fieldClass} w-[130px] uppercase`}
                />
              </>
            )}
            <button
              type="submit"
              // An admin recovering with the setup code may not remember their username.
              disabled={pending || !server.trim() || (mode !== "reset" && !username.trim()) || !password}
              className="rounded bg-accent px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50"
            >
              {pending
                ? t("Checking…")
                : mode === "signin"
                  ? t("Sign in")
                  : mode === "reset"
                    ? t("Set password")
                    : t("Create account")}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "create" : "signin");
                setNote(null);
              }}
              className="text-[12px] text-muted-2 hover:text-accent"
            >
              {mode === "signin" ? t("New here? Create an account") : t("Have an account? Sign in")}
            </button>
            {mode === "signin" && (
              <button
                type="button"
                onClick={() => {
                  setMode("reset");
                  setNote(null);
                }}
                className="text-[12px] text-muted-2 hover:text-accent"
              >
                {t("Forgot password?")}
              </button>
            )}
          </form>
        </Row>
      )}
    </Section>
  );
}

/**
 * The signed-in coach's password and sign-ins. A forgotten password goes through the admin:
 * they make a reset code, and "Forgot password?" on the sign-in form takes it.
 */
function SignInSecurity() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [computers, setComputers] = useState<number | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteNote, setDeleteNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    accountStatus().then((s) => {
      if (!live) return;
      setStatus(s);
      if (s.signedIn) signedInComputers().then((r) => live && setComputers(r.sessions ?? null));
    });
    return () => {
      live = false;
    };
  }, []);

  function run(action: () => Promise<{ ok: boolean; message: string }>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      setNote(result);
      if (result.ok) after?.();
      const r = await signedInComputers();
      setComputers(r.sessions ?? null);
    });
  }

  const mismatch = next !== "" && again !== "" && next !== again;

  return (
    <Section
      id="sign-in"
      title="Password and sign-in"
      hint="Your account on the Topset server. Forgot your password? Ask your admin for a reset code, then use “Forgot password?” where you sign in."
    >
      {!status?.signedIn ? (
        <Row label="Account" hint="Sign in under Account and athlete app first.">
          <span className="text-[12px] text-muted">{t("Not signed in")}</span>
        </Row>
      ) : (
        <>
          <Row
            label="Change password"
            stacked
            hint={
              mismatch
                ? t("The new passwords don't match.")
                : note
                  ? t(note.message)
                  : t("At least 8 characters. Every other computer signed in to your account is signed out.")
            }
            warn={mismatch || note?.ok === false}
          >
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => changePassword(current, next),
                  () => {
                    setCurrent("");
                    setNext("");
                    setAgain("");
                  },
                );
              }}
            >
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder={t("Current password")}
                className={`${fieldClass} w-[170px]`}
              />
              <input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder={t("New password")}
                className={`${fieldClass} w-[170px]`}
              />
              <input
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                placeholder={t("New password again")}
                className={`${fieldClass} w-[170px]`}
              />
              <button
                type="submit"
                disabled={pending || !current || next.length < 8 || next !== again}
                className="rounded bg-accent px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50"
              >
                {t("Change password")}
              </button>
            </form>
          </Row>
          <Row
            label="Signed-in computers"
            hint="Lost a laptop, or signed in somewhere you shouldn't stay? Sign the others out; this one stays signed in."
          >
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted">
                {computers === null ? "…" : plural(computers, "{n} computer", "{n} computers")}
              </span>
              <button
                type="button"
                disabled={pending || computers === null || computers <= 1}
                onClick={() => run(signOutOtherComputers)}
                className="rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {t("Sign out the others")}
              </button>
            </div>
          </Row>
          <Row
            label="Delete account"
            stacked
            hint={
              deleteNote
                ? t(deleteNote.message)
                : t(
                    "Deletes your account on the server and everything in it — athletes, programs, what they logged — and stops their links. Your data on this computer stays. Your username is free to sign up again.",
                  )
            }
            warn={deleteNote?.ok === false}
          >
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!window.confirm(t("Delete your account and everything in it on the server? This can't be undone."))) return;
                startTransition(async () => {
                  const result = await deleteMyAccount(deletePassword);
                  setDeleteNote(result);
                  setDeletePassword("");
                  if (result.ok) setStatus(await accountStatus());
                });
              }}
            >
              <input
                type="password"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder={t("Your password")}
                className={`${fieldClass} w-[170px]`}
              />
              <button
                type="submit"
                disabled={pending || !deletePassword}
                className="rounded border border-red-400/60 px-2.5 py-1 text-[12px] text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {t("Delete my account")}
              </button>
            </form>
          </Row>
        </>
      )}
    </Section>
  );
}

/**
 * For the admin: every coach with an account, what they may do, and the invite codes still
 * open. Turning an account off keeps its data; it just can't sign in, sync, or keep its
 * athletes' links working until it's turned back on.
 */
function Coaches() {
  const [data, setData] = useState<{ coaches: CoachListing[]; invites: InviteListing[]; error?: string } | null>(null);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [reset, setReset] = useState<{ id: string; code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    listCoaches().then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, []);

  function act(run: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await run();
      setError(result.error ?? null);
      setData(await listCoaches());
    });
  }

  const button =
    "rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-50";

  return (
    <Section id="coaches" title="Coaches" hint="Only you, the admin, see this. You see who has an account, never their athletes.">
      <Row label="Accounts" stacked hint={error ?? data?.error ?? undefined} warn={Boolean(error ?? data?.error)}>
        <div className="space-y-1.5">
          {data === null && <span className="text-[12px] text-muted">…</span>}
          {data?.coaches.map((c) => (
            <div key={c.id}>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className={`font-medium ${c.disabled ? "text-muted line-through" : ""}`}>{c.name}</span>
                <span className="text-muted-2">{c.username}</span>
                {c.isAdmin && <span className="rounded bg-surface-3 px-1.5 text-[10px] text-muted">{t("admin")}</span>}
                {c.disabled && <span className="rounded bg-accent-soft px-1.5 text-[10px] text-accent">{t("turned off")}</span>}
                <span className="ml-auto text-muted-2">{plural(c.athletes, "{n} athlete", "{n} athletes")}</span>
                {!c.disabled && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const made = await manageCoach(c.id, "reset");
                        setError(made.error ?? null);
                        if (made.code && made.expiresAt) setReset({ id: c.id, code: made.code, expiresAt: made.expiresAt });
                      })
                    }
                    className={button}
                  >
                    {t("Reset password")}
                  </button>
                )}
                {!c.isAdmin &&
                  (c.disabled ? (
                    <button type="button" disabled={pending} onClick={() => act(() => manageCoach(c.id, "restore"))} className={button}>
                      {t("Turn back on")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            t(
                              "Turn off {name}'s account? They are signed out everywhere and their athletes' links stop working. Nothing is deleted, and you can turn it back on.",
                              { name: c.name },
                            ),
                          )
                        ) {
                          act(() => manageCoach(c.id, "revoke"));
                        }
                      }}
                      className={`${button} hover:!border-red-400 hover:!text-red-400`}
                    >
                      {t("Turn off")}
                    </button>
                  ))}
                {!c.isAdmin && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (
                        window.confirm(
                          t(
                            "Delete {name}'s account and everything in it — athletes, programs, what they logged? Their links stop and their username is free again. This can't be undone.",
                            { name: c.name },
                          ),
                        )
                      ) {
                        act(() => manageCoach(c.id, "delete"));
                      }
                    }}
                    className={`${button} !border-red-400/60 !text-red-400 hover:!bg-red-500/10`}
                  >
                    {t("Delete")}
                  </button>
                )}
              </div>
              {reset?.id === c.id && (
                <p className="mt-1 text-[12px] text-muted">
                  {t("Reset code for {name}:", { name: c.name })}{" "}
                  <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-foreground">{reset.code}</code>{" "}
                  {t("— works once, until {date}. They enter it under “Forgot password?” when signing in.", {
                    date: new Date(reset.expiresAt).toLocaleString(),
                  })}
                </p>
              )}
            </div>
          ))}
        </div>
      </Row>

      <Row
        label="Invite codes"
        stacked
        hint="A new coach enters the code when creating their account. Each works once, for two weeks."
      >
        <div className="space-y-1.5">
          {data?.invites.map((i) => (
            <div key={i.code} className="flex items-center gap-2 text-[12px] text-muted">
              <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-foreground">{i.code}</code>
              <span className="truncate">{i.note}</span>
              <span className="ml-auto text-muted-2">
                {t("open until {date}", { date: new Date(i.expiresAt).toLocaleDateString() })}
              </span>
              <button type="button" disabled={pending} onClick={() => act(() => deleteInvite(i.code))} className={button}>
                {t("Withdraw")}
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("Who it's for (optional)")}
              className={`${fieldClass} w-[200px]`}
            />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const made = await createInvite(label);
                  setError(made.error ?? null);
                  if (made.invite) {
                    setFresh(made.invite.code);
                    setLabel("");
                  }
                  setData(await listCoaches());
                })
              }
              className="rounded bg-accent px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50"
            >
              {t("Invite a coach")}
            </button>
            {fresh && (
              <span className="text-[12px] text-muted">
                {t("New code:")} <code className="font-mono text-foreground">{fresh}</code>
              </span>
            )}
          </div>
        </div>
      </Row>
    </Section>
  );
}

function Data({ settings, update }: Props) {
  const b = settings.backup;
  const setBackup = (patch: Partial<CoachSettings["backup"]>) => update({ backup: { ...b, ...patch } });
  const [folderNote, setFolderNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [restore, setRestore] = useState<RestoreStatus | null>(null);

  return (
    <Section id="data" title="Backup and data">
      <Row label="Automatic backups" hint="Taken when the desktop app opens.">
        <Switch on={b.enabled} onChange={(v) => setBackup({ enabled: v })} />
      </Row>
      <Row label="Every">
        <NumberField value={b.everyDays} min={1} max={60} width={60} suffix={t("days")} onCommit={(v) => setBackup({ everyDays: v ?? 1 })} />
      </Row>
      <Row label="Keep the last">
        <NumberField value={b.keep} min={1} max={365} width={60} suffix={t("backups")} onCommit={(v) => setBackup({ keep: v ?? 14 })} />
      </Row>
      <Row label="Backup folder" hint={folderNote ? t(folderNote.message) : t("Empty: the topset-backups folder beside the app.")} warn={folderNote?.ok === false}>
        <TextField
          value={b.folder ?? ""}
          placeholder={"D:\\Backups\\Topset"}
          width={260}
          onCommit={async (v) => {
            const check = await checkBackupFolder(v);
            setFolderNote(check);
            if (check.ok) setBackup({ folder: v.trim() || null });
          }}
        />
      </Row>
      <Row label="Back up now" hint={restore ? t(restore.text) : t("All athletes and programs as one file.")} warn={restore?.tone === "error"}>
        <div className="flex gap-1.5">
          <a href="/api/backup" download className="rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent">
            {t("Download")}
          </a>
          <button
            type="button"
            onClick={async () => {
              const file = await pickFile(".db");
              if (file) setRestore(await restoreBackup(file));
            }}
            className="rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent"
          >
            {t("Restore…")}
          </button>
        </div>
      </Row>
      <Row label="Undo reaches back" hint="Steps kept per program while it is open.">
        <NumberField value={settings.undoLimit} min={10} max={1000} width={70} suffix={t("steps")} onCommit={(v) => update({ undoLimit: v ?? 100 })} />
      </Row>
    </Section>
  );
}

function App({ settings, update }: Props) {
  return (
    <Section id="app" title="App">
      <Row label="Language">
        <Select
          value={settings.language}
          options={LANGUAGES.map((l) => [l.id, l.name])}
          onChange={(v) => {
            update({ language: v as CoachSettings["language"] });
            // Every screen reads its text once; a reload redraws them all in the new language.
            setTimeout(() => location.reload(), 400);
          }}
        />
      </Row>
      <Row label="Open on start">
        <Select
          value={settings.startScreen}
          options={[
            ["programming", t("Programming")],
            ["overview", t("Overview")],
            ["last", t("Where I left off")],
          ]}
          onChange={(v) => update({ startScreen: v as CoachSettings["startScreen"] })}
        />
      </Row>
      <Row label="Show the tutorial on first start" hint="For a new computer or a fresh install.">
        <Switch on={settings.showTutorial} onChange={(v) => update({ showTutorial: v })} />
      </Row>
      <Row label="Reset every setting" hint="Your athletes and programs stay; only settings go back to how Topset ships.">
        <ResetAll />
      </Row>
    </Section>
  );
}

function ResetAll() {
  const [sure, setSure] = useState(false);
  const [, startTransition] = useTransition();
  if (!sure) {
    return (
      <button type="button" onClick={() => setSure(true)} className="rounded border border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent">
        {t("Reset…")}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            for (const key of Object.keys(DEFAULTS)) await resetSetting(key);
            for (const key of Object.keys(PREF_DEFAULTS) as (keyof typeof PREF_DEFAULTS)[]) resetPref(key);
            location.reload();
          })
        }
        className="rounded bg-accent px-2.5 py-1 text-[12px] font-medium text-white"
      >
        {t("Reset everything")}
      </button>
      <button type="button" onClick={() => setSure(false)} className="text-[12px] text-muted-2 hover:text-foreground">
        {t("Cancel")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Building blocks

function Section({
  id,
  title,
  hint,
  local = false,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  local?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-7 scroll-mt-6">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[11px] tracking-[0.16em] text-muted-2">{t(title).toUpperCase()}</h2>
        {local && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-2">{t("this computer")}</span>}
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-2">{t(hint)}</p>}
      <div className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">{children}</div>
    </section>
  );
}

function Row({
  label: text,
  hint,
  warn = false,
  stacked = false,
  action,
  children,
}: {
  label: string;
  hint?: string;
  warn?: boolean;
  stacked?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const head = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 text-[13px]">
        {t(text)}
        {action}
      </div>
      {hint && <div className={`mt-0.5 text-[11px] leading-snug ${warn ? "text-accent" : "text-muted-2"}`}>{t(hint)}</div>}
    </div>
  );
  return stacked ? (
    <div className="px-4 py-3">
      {head}
      <div className="mt-2">{children}</div>
    </div>
  ) : (
    <div className="flex items-center gap-4 px-4 py-3">
      {head}
      {children}
    </div>
  );
}

/** The RPE × reps chart, every cell editable. */
function RpeChart({
  table,
  onChange,
}: {
  table: CoachSettings["rpeTable"];
  onChange: (table: CoachSettings["rpeTable"]) => void;
}) {
  const set = (r: number, c: number, v: number | null) =>
    onChange({
      ...table,
      pct: table.pct.map((row, i) => (i === r ? row.map((x, j) => (j === c ? (v ?? x) : x)) : row)),
    });
  const fmt = (n: number) => String(n).replace(".", activeSettings().language === "en" ? "." : ",");

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="px-1.5 py-1 text-left font-normal text-muted-2">{t("Reps")}</th>
            {table.reps.map((reps) => (
              <th key={reps} className="px-1 py-1 text-center font-normal text-muted-2">
                {reps}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rpe.map((rpe, r) => (
            <tr key={rpe}>
              <th className="px-1.5 py-0.5 text-left font-normal whitespace-nowrap text-muted-2">RPE {fmt(rpe)}</th>
              {table.reps.map((reps, c) => (
                <td key={reps} className="p-0.5">
                  <span className="flex items-center rounded border border-border bg-background pr-1">
                    <NumberField value={table.pct[r][c]} step={0.5} width={40} min={1} max={100} onCommit={(v) => set(r, c, v)} bare />
                    <span className="text-muted-2">%</span>
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Each target with its colour: pick one, or switch it off. */
function TargetColors({ targets }: { targets: string[] }) {
  const colors = usePref("targetColors");
  const set = (target: string, color: string) => {
    // Stored under the name as the colours already have it, so "squat" and "Squat" stay one.
    const key = Object.keys(colors).find((k) => k.trim().toLowerCase() === target.trim().toLowerCase()) ?? target;
    setPref("targetColors", { ...colors, [key]: color });
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {targets.map((target) => {
        const color = colorOfTarget(colors, target);
        return (
          <span
            key={target}
            className="flex items-center gap-1.5 rounded-md border border-border py-0.5 pl-1 pr-2 text-[12px]"
          >
            {color ? (
              <input
                type="color"
                value={color}
                onChange={(e) => set(target, e.target.value)}
                className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent"
                title={t("Colour on this computer")}
              />
            ) : (
              <button
                type="button"
                onClick={() => set(target, "#8b8b98")}
                title={t("Give it a colour")}
                className="grid h-5 w-6 place-items-center rounded border border-dashed border-border text-muted-2 hover:text-accent"
              >
                +
              </button>
            )}
            <span className={color ? "" : "text-muted"}>{target}</span>
            {color && (
              <button
                type="button"
                onClick={() => set(target, "")}
                title={t("No colour")}
                className="text-muted-2 hover:text-accent"
              >
                ×
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function ResetLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[11px] text-muted-2 hover:text-accent">
      {t("reset")}
    </button>
  );
}

const fieldClass =
  "rounded border border-border bg-background px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-accent/60";

function TextField({
  value,
  onCommit,
  width,
  placeholder,
  list,
}: {
  value: string;
  onCommit: (v: string) => void;
  width: number;
  placeholder?: string;
  list?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft.trim());
  };
  return (
    <input
      value={draft}
      list={list}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value);
      }}
      style={{ width }}
      className={fieldClass}
    />
  );
}

function NumberField({
  value,
  onCommit,
  width,
  min,
  max,
  step = 1,
  suffix,
  bare = false,
}: {
  value: number;
  onCommit: (v: number | null) => void;
  width: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  bare?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(String(value));
  }
  const commit = () => {
    const n = Number(draft.replace(",", "."));
    if (draft.trim() === "" || !Number.isFinite(n)) return setDraft(String(value));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (clamped !== value) onCommit(clamped);
    setDraft(String(clamped));
  };
  const input = (
    <input
      value={draft}
      inputMode="decimal"
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(String(value));
      }}
      style={{ width }}
      className={bare ? "bg-transparent px-1 py-1 text-[12px] outline-none" : `${fieldClass} text-right`}
    />
  );
  return suffix ? (
    <span className="flex items-center gap-1.5">
      {input}
      <span className="text-[11px] text-muted-2">{suffix}</span>
    </span>
  ) : (
    input
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: (readonly [string, string] | string[])[];
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldClass} cursor-pointer`}>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-surface-3"}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

function TagList({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.map((v, i) => (
        <span key={v} className="flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[12px]">
          {values.length > 1 && i > 0 && (
            <button type="button" title={t("Move left")} onClick={() => onChange(values.map((x, j) => (j === i - 1 ? v : j === i ? values[i - 1] : x)))} className="text-muted-2 hover:text-foreground">
              ‹
            </button>
          )}
          {v}
          <button type="button" title={t("Remove")} onClick={() => onChange(values.filter((x) => x !== v))} className="text-muted-2 hover:text-accent">
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        className={`${fieldClass} w-[150px]`}
      />
    </div>
  );
}

function PresetEditor({ presets, onChange }: { presets: ProgressionPreset[]; onChange: (v: ProgressionPreset[]) => void }) {
  const set = (i: number, patch: Partial<ProgressionPreset>) => onChange(presets.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const fieldNames = useMemo(
    () => [
      ["INTENSITY", t("Intensity")],
      ["REPS", t("Reps")],
      ["SETS", t("Sets")],
    ],
    [],
  );
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5 text-[10px] tracking-[0.12em] text-muted-2">
        <span className="w-[170px]">{t("LABEL")}</span>
        <span className="w-[92px]">{t("FIELD")}</span>
        <span className="w-[62px]">{t("HOW")}</span>
        <span className="w-[56px]">{t("BY")}</span>
        <span className="w-[56px]">{t("EVERY")}</span>
        <span className="w-[56px]">{t("FROM WK")}</span>
        <span className="w-[56px]">{t("TO WK")}</span>
      </div>
      {presets.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <TextField value={p.label} width={170} onCommit={(v) => set(i, { label: v || p.label })} />
          <Select value={p.field} options={fieldNames} onChange={(v) => set(i, { field: v as ProgressionPreset["field"] })} />
          <Select
            value={p.op}
            options={[
              ["ADD", "+"],
              ["MULTIPLY", "×"],
            ]}
            onChange={(v) => set(i, { op: v as ProgressionPreset["op"] })}
          />
          <NumberField value={p.amount} step={0.5} width={56} onCommit={(v) => set(i, { amount: v ?? p.amount })} />
          <NumberField value={p.everyWeeks} min={1} width={56} onCommit={(v) => set(i, { everyWeeks: v ?? 1 })} />
          <NumberField value={p.startWeek} min={1} width={56} onCommit={(v) => set(i, { startWeek: v ?? 2 })} />
          <TextField
            value={p.endWeek === null ? "" : String(p.endWeek)}
            placeholder={t("end")}
            width={56}
            onCommit={(v) => set(i, { endWeek: v.trim() === "" || !Number.isFinite(Number(v)) ? null : Math.max(1, Math.round(Number(v))) })}
          />
          <button type="button" onClick={() => onChange(presets.filter((_, j) => j !== i))} className="px-1 text-[13px] text-muted-2 hover:text-accent" title={t("Remove")}>
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...presets, { label: "+1 / week", field: "INTENSITY", op: "ADD", amount: 1, everyWeeks: 1, startWeek: 2, endWeek: null }])}
        className="rounded border border-dashed border-border px-2.5 py-1 text-[12px] text-muted hover:border-accent hover:text-accent"
      >
        + {t("Add preset")}
      </button>
    </div>
  );
}
