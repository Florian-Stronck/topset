"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createExampleAthlete, deleteAthlete } from "@/app/athletes/actions";
import { activeSettings } from "@/lib/settings";
import { t } from "@/lib/i18n";

type Section = "overview" | "athletes" | "programming" | "tracking" | "competition" | "settings";

type Step = {
  /** The screen this step is about; the tour opens it when the step comes up. */
  page: Section;
  /** A `data-tour` name to spotlight. Without one — or if it isn't on screen — the card sits centred. */
  target?: string;
  title: string;
  /**
   * English text, translated when shown. Blank lines split paragraphs, lines starting
   * "- " make a list, and <b>, <i> and <k> (a key) mark text up inline.
   */
  body: string;
};

const K = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-border bg-surface px-1 py-px font-mono text-[11px] text-foreground">
    {children}
  </kbd>
);

const STEPS: Step[] = [
  {
    page: "programming",
    title: "Welcome to Topset",
    body: "Topset is where you write training programs for your lifters and hand them out as a spreadsheet, a phone PDF or a printout. This tour takes about two minutes.\n\nWant an example athlete to follow along with? You can delete it at the end.",
  },
  {
    page: "programming",
    target: "roster",
    title: "Your athletes",
    body: "Everyone you coach is listed here. Click a name to open their programs. <b>+ Add athlete</b> creates a new one with their 1RMs and kg or lb.",
  },
  {
    page: "programming",
    target: "nav",
    title: "The five screens",
    body: "- <b>Overview</b> — who is in which week, and who needs a new program soon.\n- <b>Athletes</b> — the roster and everyone's 1RMs.\n- <b>Programming</b> — where you write the plan. You are here.\n- <b>Tracking</b> — what the athlete actually lifted.\n- <b>Competition</b> — meets and attempt planning.",
  },
  {
    page: "programming",
    target: "program",
    title: "Programs",
    body: "A program is one whole plan, like “Nationals Prep”. Switch between an athlete's programs here, or start one with <b>+ New program</b>. <b>Copy program</b> reuses a plan for another athlete.",
  },
  {
    page: "programming",
    target: "phases",
    title: "Phases",
    body: "A program is split into phases (blocks) — for example Volume → Strength → Peaking. Each phase has its own start date, weeks and 1RMs. <b>+ phase</b> adds the next one.\n\nIf there's a break or an overlap between two phases, a coloured chip shows up between them. Click it to fix it — or keep a break for a holiday.",
  },
  {
    page: "programming",
    target: "weeks",
    title: "Weeks",
    body: "One tab per week. <b>+ add week</b> copies the week before, so you only change what's different. With lots of weeks, scroll the bar sideways. The <b>×</b> on a tab deletes that week.",
  },
  {
    page: "programming",
    target: "names",
    title: "Names",
    body: "Click the program or phase name here to rename it.",
  },
  {
    page: "programming",
    target: "maxes",
    title: "1RMs for this phase",
    body: "Loads written as a percentage or an RPE are turned into kilos from these maxes. Change a number and every weight in the phase updates. Other phases keep their own.",
  },
  {
    page: "programming",
    target: "day",
    title: "Writing a session",
    body: "Each training day is a small table. Click any cell and type — it <b>saves by itself</b>, no save button. The faded last row becomes a new exercise as soon as you type in it.\n\nArrow keys move between cells. While typing an exercise, <k>Tab</k> accepts the suggestion. The tier and target (Squat, Bench…) fill in for you.",
  },
  {
    page: "programming",
    target: "intensity",
    title: "Intensity",
    body: "Click an intensity cell to choose how the load is written: <b>RPE</b>, <b>RIR</b>, <b>% of 1RM</b>, <b>kilos</b>, a <b>range</b>, or a <b>backoff</b> (like −10% off the top set). You can also ramp sets up to the target weight.",
  },
  {
    page: "programming",
    target: "progression",
    title: "Progression rules",
    body: "Rules write the later weeks for you — like <i>+2.5 kg per week</i> or <i>+0.5 RPE per week</i>. Write week 1, add a rule, and weeks 2, 3, 4… fill themselves in. <b>Apply progressions</b> runs every rule again.",
  },
  {
    page: "programming",
    target: "lock",
    title: "Locking a week",
    body: "Lock a week — a deload, say — and progression rules will never overwrite it. When you add a week, it copies the last <i>unlocked</i> week.",
  },
  {
    page: "programming",
    target: "undo",
    title: "Undo",
    body: "Made a mistake? <b>↶</b> or <k>Ctrl</k>+<k>Z</k> undoes it, <b>↷</b> or <k>Ctrl</k>+<k>Y</k> redoes it. Hover the button to see what it would undo.",
  },
  {
    page: "programming",
    target: "exports",
    title: "Sending it out",
    body: "<b>Export</b> opens every way out, grouped by who it's for:\n- <b>.xlsx</b> — the whole program, one sheet per phase.\n- <b>Phone .pdf</b> and <b>Print</b> — for the athlete; printed pages have boxes to write in what was done.\n- <b>Repwise</b>, <b>.csv</b> and a full <b>backup</b> — for other tools and safekeeping.",
  },
  {
    page: "programming",
    target: "settings",
    title: "Settings and backups",
    body: "Rename things, move a phase's start date, set its 1RMs, and import or export program files. Everything else — units, defaults, exports, language — is under <b>Settings</b> at the bottom of the sidebar. Topset also saves a backup automatically when you open it.",
  },
  {
    page: "programming",
    title: "The shortcut to everything",
    body: "Press <k>Ctrl</k>+<k>K</k> for a search box with every action — jump to a week, export, print, switch athlete. <k>Alt</k>+<k>/</k> lists all the keyboard shortcuts.",
  },
  {
    page: "tracking",
    title: "Tracking",
    body: "After training, enter what the athlete actually lifted — weight, RPE and notes. Charts show progress over every phase, and Topset can estimate a new 1RM from good sets and save it with one click.",
  },
  {
    page: "competition",
    title: "Competition",
    body: "Add a meet, let Topset plan all nine attempts from the 1RMs, then mark each one good or missed on the day. A meet also shows up in the programming grid on its date, with a button to fill in the attempts.",
  },
  {
    page: "programming",
    title: "You're ready",
    body: "That's everything you need to start. You can open this tour again any time from <b>Tutorial</b> at the bottom of the sidebar.",
  },
];

/** Inline <b>, <i> and <k> in a translated line, as elements. */
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /<(b|i|k)>(.*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, tag, inner] = m;
    out.push(tag === "b" ? <b key={m.index}>{inner}</b> : tag === "i" ? <i key={m.index}>{inner}</i> : <K key={m.index}>{inner}</K>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A step's text in the coach's language: paragraphs, lists and inline markup. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n\n").map((block, i) => {
        const lines = block.split("\n");
        const items = lines.filter((l) => l.startsWith("- "));
        const lead = lines.filter((l) => !l.startsWith("- "));
        return (
          <div key={i} className={i > 0 ? "mt-2" : ""}>
            {lead.length > 0 && <p>{inline(lead.join(" "))}</p>}
            {items.length > 0 && (
              <ul className={`list-disc space-y-0.5 pl-4 ${lead.length > 0 ? "mt-1" : ""}`}>
                {items.map((item, j) => (
                  <li key={j}>{inline(item.slice(2))}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}

const STORAGE_KEY = "topset.tutorial";

const CHANGE_EVENT = "topset:tutorial-change";

type Saved = { open: boolean; step: number; exampleId: string | null };

/** Never seen the tour: it opens on its own. */
const FIRST_RUN = JSON.stringify({ open: true, step: 0, exampleId: null } satisfies Saved);

/** The tour hasn't run on this computer: it opens on its own, unless the coach said not to. */
function firstRun(): string {
  return activeSettings().showTutorial ? FIRST_RUN : JSON.stringify({ open: false, step: 0, exampleId: null } satisfies Saved);
}

function readRaw(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? firstRun();
  } catch {
    // Storage blocked: behave as already seen rather than nag on every screen.
    return JSON.stringify({ open: false, step: 0, exampleId: null } satisfies Saved);
  }
}

function save(state: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Opens the tour from anywhere — the sidebar button, the command palette. */
export function startTutorial() {
  const current = JSON.parse(readRaw()) as Saved;
  save({ open: true, step: 0, exampleId: current.exampleId });
}

const CARD_W = 340;
const GAP = 12;

/**
 * A walkthrough for someone who has never seen the app. It opens by itself the first time,
 * moves between screens as it goes, and spotlights the real control each step is about. The
 * step lives in localStorage because every screen mounts its own sidebar, and this with it.
 */
export function Tutorial({ section, athleteId }: { section: Section; athleteId?: string }) {
  const router = useRouter();
  // The server has no localStorage, so it renders the tour closed and the client opens it.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const state = useMemo(() => (raw ? (JSON.parse(raw) as Saved) : null), [raw]);
  const [spot, setSpot] = useState<{ key: string; rect: DOMRect } | null>(null);
  const [busy, setBusy] = useState(false);

  const update = save;

  const step = state?.open ? STEPS[state.step] : undefined;
  const onPage = step?.page === section;
  const spotKey = `${state?.step}:${section}`;
  const rect = spot?.key === spotKey ? spot.rect : null;

  // Find the spotlit control, waiting a little for a screen that is still loading.
  useLayoutEffect(() => {
    if (!step?.target || !onPage) return;

    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    let el: HTMLElement | null = null;

    const measure = () => {
      if (el?.isConnected) setSpot({ key: spotKey, rect: el.getBoundingClientRect() });
    };
    const find = () => {
      el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        requestAnimationFrame(measure);
      } else if (tries++ < 20) {
        timer = setTimeout(find, 100);
      }
    };
    find();

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, onPage, spotKey]);

  if (!state || !step) return null;

  const athlete = state.exampleId ?? athleteId;
  const go = (index: number, exampleId = state.exampleId) => {
    const next = STEPS[index];
    update({ open: true, step: index, exampleId });
    if (next.page !== section) {
      const who = exampleId ?? athleteId;
      router.push(`/${next.page}${who ? `?athlete=${who}` : ""}`);
    }
  };
  const close = () => update({ ...state, open: false });

  async function makeExample() {
    setBusy(true);
    try {
      const id = await createExampleAthlete();
      update({ open: true, step: 1, exampleId: id });
      router.push(`/programming?athlete=${id}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeExample() {
    if (!state?.exampleId) return;
    setBusy(true);
    try {
      await deleteAthlete(state.exampleId);
      update({ open: false, step: 0, exampleId: null });
      router.push("/programming");
    } finally {
      setBusy(false);
    }
  }

  const last = state.step === STEPS.length - 1;
  const first = state.step === 0;

  // The card sits under the spotlight when there's room, over it when there isn't.
  let cardStyle: React.CSSProperties;
  if (rect) {
    const CARD_H = 260;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - CARD_W - 12));
    if (rect.bottom + GAP + CARD_H < window.innerHeight) {
      cardStyle = { top: rect.bottom + GAP, left };
    } else if (rect.top - GAP - CARD_H > 0) {
      cardStyle = { bottom: window.innerHeight - rect.top + GAP, left };
    } else {
      // Too tall to sit beside — tuck the card into the corner over it.
      cardStyle = { bottom: 16, right: 16 };
    }
  } else {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[200]">
      {rect ? (
        <div
          className="absolute rounded-lg ring-2 ring-accent transition-all duration-200"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      <div
        role="dialog"
        aria-label={t(step.title)}
        style={{ ...cardStyle, width: CARD_W }}
        className="pointer-events-auto absolute rounded-xl border border-border bg-surface-2 p-4 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] tracking-[0.14em] text-muted-2">
            TUTORIAL · {state.step + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            onClick={close}
            title={t("Close the tutorial")}
            className="rounded px-1 text-[14px] leading-none text-muted-2 hover:text-foreground"
          >
            ×
          </button>
        </div>

        <h2 className="mt-1.5 text-[15px] font-semibold">{t(step.title)}</h2>
        <div className="mt-1.5 text-[12px] leading-relaxed text-muted">
          <Rich text={t(step.body)} />
        </div>

        {!onPage && (
          <button
            type="button"
            onClick={() => go(state.step)}
            className="mt-2 text-[11px] text-accent hover:underline"
          >
            Go to {step.page[0].toUpperCase() + step.page.slice(1)} →
          </button>
        )}
        {onPage && step.target && !rect && (
          <p className="mt-2 text-[11px] text-muted-2">
            {t("(Open a program to see this on screen.)")}
          </p>
        )}

        {first ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={makeExample}
              className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white disabled:opacity-60"
            >
              {busy ? "Creating…" : "Create an example athlete"}
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted hover:text-foreground"
            >
              {t("Use my own athletes")}
            </button>
            <button
              type="button"
              onClick={close}
              className="text-[11px] text-muted-2 hover:text-foreground"
            >
              {t("Skip the tutorial")}
            </button>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => go(state.step - 1)}
              className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-foreground"
            >
              {t("Back")}
            </button>
            {last ? (
              <>
                {state.exampleId && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={removeExample}
                    className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted hover:text-foreground disabled:opacity-60"
                  >
                    {t("Delete example")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={close}
                  className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white"
                >
                  {t("Finish")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => go(state.step + 1)}
                className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white"
              >
                {t("Next")}
              </button>
            )}
          </div>
        )}
        {athlete === undefined && !first && section === "programming" && (
          <p className="mt-2 text-[11px] text-muted-2">
            {t("Tip: add an athlete first, or restart and pick the example.")}
          </p>
        )}
      </div>
    </div>
  );
}
