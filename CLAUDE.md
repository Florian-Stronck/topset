@AGENTS.md

# Every feature, before it is done

- **Command palette:** an action or toggle gets a `COMMAND_SPECS` entry in `src/lib/shortcuts.ts` (so it can be rebound) and a `Command` registered with `useCommands` where it lives.
- **Translations:** every user-visible string goes through `t()` and gets an entry in `src/lib/i18n/de.ts`, `fr.ts` and `lb.ts`.
- **Settings:** a new preference gets a control in `src/components/SettingsView.tsx`, and every setting there that is a view toggle should also be reachable from the palette.
