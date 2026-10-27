export const CAL_COLORS = [
  { id: "terracotta", hex: "#9c4221", label: "Terracotta" },
  { id: "forest", hex: "#245c42", label: "Forest" },
  { id: "harbor", hex: "#243f66", label: "Harbor" },
  { id: "ochre", hex: "#8a6412", label: "Ochre" },
  { id: "plum", hex: "#5e3450", label: "Plum" },
  { id: "tide", hex: "#1f5c5c", label: "Tide" },
] as const;

export type ViewMode = "day" | "week" | "month";
export type ThemeMode = "light" | "dark";

export type ImportedCalendar = {
  id: string;
  name: string;
  type: "file" | "feed";
  path: string;
  url: string;
  ics: string;
  fetchedAt: string;
};

export type AppEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  notes: string;
};

export type AppCalendar = {
  id: string;
  name: string;
  events: AppEvent[];
};

export type Prefs = {
  theme: ThemeMode;
  view: ViewMode;
  colors: Record<string, string>;
  enabled: Record<string, boolean>;
  initialized: boolean;
};

export type CalsFile = { calendars: ImportedCalendar[] };
export type AppCalsFile = { calendars: AppCalendar[] };

export type Occurrence = {
  key: string;
  calendarId: string;
  eventId: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string;
  notes: string;
  readOnly: boolean;
};

export const INK = "#1c1915";
export const PAPER = "#fff8f3";

export function textOn(hex: string): string {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return PAPER;
  const n = Number.parseInt(raw, 16);
  if (Number.isNaN(n)) return PAPER;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return l > 0.62 ? INK : PAPER;
}

export function colorFor(prefs: Prefs, id: string, index: number): string {
  return prefs.colors[id] ?? CAL_COLORS[index % CAL_COLORS.length].hex;
}

export function isEnabled(prefs: Prefs, id: string): boolean {
  return prefs.enabled[id] !== false;
}
