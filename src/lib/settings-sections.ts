/**
 * The settings page's sections, in order: its side menu (under their group), and the palette's
 * "Settings: …". The page renders them in this same order.
 */
export const SETTINGS_SECTIONS = [
  { id: "account", title: "Profile", group: "General" },
  { id: "units", title: "Units and numbers", group: "Programming" },
  { id: "programming", title: "Programming defaults", group: "Programming" },
  { id: "calendar", title: "Calendar and dates", group: "Programming" },
  { id: "exercises", title: "Exercises", group: "Programming" },
  { id: "tracking", title: "Tracking and competition", group: "Athletes and results" },
  { id: "exports", title: "Exports and print", group: "Athletes and results" },
  { id: "view", title: "Grid and view", group: "This computer" },
  { id: "keyboard", title: "Keyboard", group: "This computer" },
  { id: "athlete-app", title: "Account and athlete app", group: "Account and server" },
  { id: "sign-in", title: "Password and sign-in", group: "Account and server" },
  { id: "coaches", title: "Coaches", group: "Account and server", admin: true },
  { id: "data", title: "Backup and data", group: "Data" },
] as const;
