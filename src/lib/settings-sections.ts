/** The settings page's sections, in order: its side menu, and the palette's "Settings: …". */
export const SETTINGS_SECTIONS = [
  { id: "account", title: "Account" },
  { id: "units", title: "Units and numbers" },
  { id: "programming", title: "Programming defaults" },
  { id: "calendar", title: "Calendar and dates" },
  { id: "exercises", title: "Exercises" },
  { id: "view", title: "Grid and view" },
  { id: "keyboard", title: "Keyboard" },
  { id: "exports", title: "Exports and print" },
  { id: "tracking", title: "Tracking and competition" },
  { id: "athlete-app", title: "Account and athlete app" },
  { id: "sign-in", title: "Password and sign-in" },
  { id: "coaches", title: "Coaches", admin: true },
  { id: "data", title: "Backup and data" },
  { id: "app", title: "App" },
] as const;
