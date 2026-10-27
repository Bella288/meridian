import { addDays, format, startOfDay } from "date-fns";
import { useSyncExternalStore } from "react";
import {
  CAL_COLORS,
  type AppCalendar,
  type AppCalsFile,
  type AppEvent,
  type CalsFile,
  type ImportedCalendar,
  type Prefs,
  type ThemeMode,
  type ViewMode,
} from "@/lib/calendar/types";

export const CALS_KEY = "cal/cals.json";
export const PREF_KEY = "cal/pref.json";
export const APP_KEY = "cal/app-cals.json";

type Snapshot = {
  imported: ImportedCalendar[];
  appCals: AppCalendar[];
  prefs: Prefs;
};

const SERVER_SNAPSHOT: Snapshot = {
  imported: [],
  appCals: [],
  prefs: {
    theme: "light",
    view: "month",
    colors: {},
    enabled: {},
    initialized: false,
  },
};

function preferredTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

function emptyPrefs(): Prefs {
  return {
    theme: preferredTheme(),
    view: "month",
    colors: {},
    enabled: {},
    initialized: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value, null, 2));
}

function asImported(value: unknown): ImportedCalendar | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.name !== "string") return null;
  if (value.type !== "file" && value.type !== "feed") return null;
  if (typeof value.ics !== "string") return null;
  return {
    id: value.id,
    name: value.name,
    type: value.type,
    path: typeof value.path === "string" ? value.path : "",
    url: typeof value.url === "string" ? value.url : "",
    ics: value.ics,
    fetchedAt: typeof value.fetchedAt === "string" ? value.fetchedAt : "",
  };
}

function asAppEvent(value: unknown): AppEvent | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.title !== "string") return null;
  if (typeof value.start !== "string" || typeof value.end !== "string") return null;
  return {
    id: value.id,
    title: value.title,
    start: value.start,
    end: value.end,
    allDay: Boolean(value.allDay),
    location: typeof value.location === "string" ? value.location : "",
    notes: typeof value.notes === "string" ? value.notes : "",
  };
}

function asAppCalendar(value: unknown): AppCalendar | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const events = Array.isArray(value.events) ? value.events.map(asAppEvent).filter((item) => item !== null) : [];
  return { id: value.id, name: value.name, events };
}

function asPrefs(value: unknown): Prefs | null {
  if (!isRecord(value)) return null;
  const theme = value.theme === "dark" ? "dark" : value.theme === "light" ? "light" : null;
  const view = value.view === "day" || value.view === "week" || value.view === "month" ? value.view : null;
  if (!theme || !view) return null;
  const colors: Record<string, string> = {};
  const enabled: Record<string, boolean> = {};
  if (isRecord(value.colors)) {
    for (const [key, color] of Object.entries(value.colors)) {
      if (typeof color === "string") colors[key] = color;
    }
  }
  if (isRecord(value.enabled)) {
    for (const [key, on] of Object.entries(value.enabled)) enabled[key] = Boolean(on);
  }
  return { theme, view, colors, enabled, initialized: value.initialized !== false };
}

function dayStamp(offset: number): string {
  return format(addDays(startOfDay(new Date()), offset), "yyyy-MM-dd");
}

function timedStamp(offset: number, hours: number, minutes: number): string {
  const date = addDays(startOfDay(new Date()), offset);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function seedSnapshot(): Snapshot {
  const id = "studio";
  const prefs = emptyPrefs();
  prefs.initialized = true;
  prefs.colors[id] = CAL_COLORS[0].hex;
  prefs.enabled[id] = true;
  const calendar: AppCalendar = {
    id,
    name: "Studio",
    events: [
      {
        id: "morning-pages",
        title: "Morning pages",
        start: timedStamp(0, 9, 30),
        end: timedStamp(0, 10, 15),
        allDay: false,
        location: "Desk",
        notes: "Three pages before the day starts.",
      },
      {
        id: "client-review",
        title: "Client review",
        start: timedStamp(0, 14, 0),
        end: timedStamp(0, 15, 30),
        allDay: false,
        location: "North studio",
        notes: "Bring the paper samples.",
      },
      {
        id: "press-check",
        title: "Press check",
        start: dayStamp(1),
        end: dayStamp(2),
        allDay: true,
        location: "Riverside print",
        notes: "",
      },
      {
        id: "gallery-walk",
        title: "Gallery walk",
        start: timedStamp(-1, 16, 0),
        end: timedStamp(-1, 17, 30),
        allDay: false,
        location: "",
        notes: "",
      },
      {
        id: "paper-order",
        title: "Paper order",
        start: timedStamp(2, 11, 0),
        end: timedStamp(2, 11, 30),
        allDay: false,
        location: "",
        notes: "Cotton 118gsm, warm white.",
      },
      {
        id: "dinner",
        title: "Dinner with Ana",
        start: timedStamp(4, 18, 30),
        end: timedStamp(4, 20, 30),
        allDay: false,
        location: "Lumen",
        notes: "",
      },
    ],
  };
  return { imported: [], appCals: [calendar], prefs };
}

function loadSnapshot(): Snapshot {
  const importedRaw = readJson(CALS_KEY);
  const appRaw = readJson(APP_KEY);
  const prefRaw = readJson(PREF_KEY);
  const prefs = asPrefs(prefRaw);
  if (!prefs || !prefs.initialized) return seedSnapshot();
  const imported = isRecord(importedRaw) && Array.isArray(importedRaw.calendars)
    ? importedRaw.calendars.map(asImported).filter((item) => item !== null)
    : [];
  const appCals = isRecord(appRaw) && Array.isArray(appRaw.calendars)
    ? appRaw.calendars.map(asAppCalendar).filter((item) => item !== null)
    : [];
  return { imported, appCals, prefs };
}

let snapshot: Snapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  const hadPrefs = Boolean(localStorage.getItem(PREF_KEY));
  snapshot = loadSnapshot();
  applyTheme(snapshot.prefs.theme);
  if (!hadPrefs) {
    try {
      persist();
    } catch {
      /* The calendar still works for this visit if storage is blocked. */
    }
  }
}

function persist() {
  try {
    const cals: CalsFile = { calendars: snapshot.imported };
    const app: AppCalsFile = { calendars: snapshot.appCals };
    writeJson(CALS_KEY, cals);
    writeJson(APP_KEY, app);
    writeJson(PREF_KEY, snapshot.prefs);
  } catch {
    snapshot = {
      ...snapshot,
      prefs: snapshot.prefs,
    };
    throw new Error("Couldn't save. This browser may be out of storage space.");
  }
}

function commit(next: Snapshot) {
  snapshot = next;
  applyTheme(next.prefs.theme);
  try {
    persist();
  } catch (error) {
    for (const listener of listeners) listener();
    throw error;
  }
  for (const listener of listeners) listener();
}

function update(recipe: (current: Snapshot) => Snapshot) {
  commit(recipe(snapshot));
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return snapshot;
}

export function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

export function useCal() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function nextColor(current: Snapshot): string {
  const used = new Set(Object.values(current.prefs.colors));
  return CAL_COLORS.find((color) => !used.has(color.hex))?.hex ?? CAL_COLORS[0].hex;
}

function withCalendarMeta(current: Snapshot, id: string, color?: string): Prefs {
  return {
    ...current.prefs,
    initialized: true,
    colors: { ...current.prefs.colors, [id]: color ?? current.prefs.colors[id] ?? nextColor(current) },
    enabled: { ...current.prefs.enabled, [id]: current.prefs.enabled[id] !== false },
  };
}

export function setTheme(theme: ThemeMode) {
  update((current) => ({ ...current, prefs: { ...current.prefs, theme, initialized: true } }));
}

export function setView(view: ViewMode) {
  update((current) => ({ ...current, prefs: { ...current.prefs, view, initialized: true } }));
}

export function setEnabled(id: string, on: boolean) {
  update((current) => ({
    ...current,
    prefs: { ...current.prefs, enabled: { ...current.prefs.enabled, [id]: on } },
  }));
}

export function setColor(id: string, color: string) {
  update((current) => ({
    ...current,
    prefs: { ...current.prefs, colors: { ...current.prefs.colors, [id]: color } },
  }));
}

export function renameCalendar(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  update((current) => ({
    ...current,
    imported: current.imported.map((calendar) => (calendar.id === id ? { ...calendar, name: trimmed } : calendar)),
    appCals: current.appCals.map((calendar) => (calendar.id === id ? { ...calendar, name: trimmed } : calendar)),
  }));
}

export function removeCalendar(id: string) {
  update((current) => {
    const colors = { ...current.prefs.colors };
    const enabled = { ...current.prefs.enabled };
    delete colors[id];
    delete enabled[id];
    return {
      imported: current.imported.filter((calendar) => calendar.id !== id),
      appCals: current.appCals.filter((calendar) => calendar.id !== id),
      prefs: { ...current.prefs, colors, enabled, initialized: true },
    };
  });
}

export function addImported(calendar: ImportedCalendar) {
  update((current) => ({
    ...current,
    imported: [...current.imported.filter((item) => item.id !== calendar.id), calendar],
    prefs: withCalendarMeta(current, calendar.id),
  }));
}

export function updateFeed(id: string, ics: string) {
  update((current) => ({
    ...current,
    imported: current.imported.map((calendar) =>
      calendar.id === id ? { ...calendar, ics, fetchedAt: new Date().toISOString() } : calendar,
    ),
  }));
}

export function addAppCalendar(name: string): string {
  const id = crypto.randomUUID();
  const trimmed = name.trim() || "My calendar";
  update((current) => ({
    ...current,
    appCals: [...current.appCals, { id, name: trimmed, events: [] }],
    prefs: withCalendarMeta(current, id),
  }));
  return id;
}

export function saveEvent(calendarId: string, event: AppEvent) {
  update((current) => ({
    ...current,
    appCals: current.appCals.map((calendar) => {
      if (calendar.id !== calendarId) return calendar;
      const exists = calendar.events.some((item) => item.id === event.id);
      return {
        ...calendar,
        events: exists
          ? calendar.events.map((item) => (item.id === event.id ? event : item))
          : [...calendar.events, event],
      };
    }),
  }));
}

export function deleteEvent(calendarId: string, eventId: string) {
  update((current) => ({
    ...current,
    appCals: current.appCals.map((calendar) =>
      calendar.id === calendarId
        ? { ...calendar, events: calendar.events.filter((event) => event.id !== eventId) }
        : calendar,
    ),
  }));
}

export function filesFromSnapshot(current: Snapshot = snapshot) {
  return {
    "cals.json": { calendars: current.imported } satisfies CalsFile,
    "pref.json": current.prefs,
    "app-cals.json": { calendars: current.appCals } satisfies AppCalsFile,
  };
}

export function restorePayload(value: unknown): string {
  if (!isRecord(value)) throw new Error("That file isn't calendar data.");
  if ("cals.json" in value || "pref.json" in value || "app-cals.json" in value) {
    if ("cals.json" in value) restorePayload(value["cals.json"]);
    if ("app-cals.json" in value) restorePayload(value["app-cals.json"]);
    if ("pref.json" in value) restorePayload(value["pref.json"]);
    return "Restored your calendar files.";
  }
  if (Array.isArray(value.calendars)) {
    const imported = value.calendars.map(asImported).filter((item) => item !== null);
    const appCals = value.calendars.map(asAppCalendar).filter((item) => item !== null);
    const looksImported = value.calendars.some(
      (item) => isRecord(item) && (item.type === "file" || item.type === "feed" || typeof item.ics === "string"),
    );
    if (looksImported) {
      update((current) => {
        let prefs = current.prefs;
        for (const calendar of imported) prefs = withCalendarMeta({ ...current, prefs }, calendar.id);
        return { ...current, imported, prefs: { ...prefs, initialized: true } };
      });
      return `Restored ${imported.length} imported calendar${imported.length === 1 ? "" : "s"}.`;
    }
    update((current) => {
      let prefs = current.prefs;
      for (const calendar of appCals) prefs = withCalendarMeta({ ...current, prefs }, calendar.id);
      return { ...current, appCals, prefs: { ...prefs, initialized: true } };
    });
    return `Restored ${appCals.length} calendar${appCals.length === 1 ? "" : "s"} you created.`;
  }
  const prefs = asPrefs(value);
  if (prefs) {
    update((current) => ({ ...current, prefs: { ...prefs, initialized: true } }));
    return "Restored preferences.";
  }
  throw new Error("That file isn't cals.json, pref.json, or app-cals.json.");
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
