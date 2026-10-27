import { addDays, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight, Menu, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { AddCalendarDialog, EventDialog, type EventDraft } from "@/components/calendar/dialogs";
import { Sidebar, type CalendarRow } from "@/components/calendar/sidebar";
import { MonthView, TimeGrid } from "@/components/calendar/views";
import { combineDateTime, dateInputValue, periodLabel, rangeFor, shiftAnchor, timeInputValue, visibleDays } from "@/lib/calendar/dates";
import { fetchCalendarFeed, normalizeFeedUrl } from "@/lib/calendar/fetch-feed";
import { expandAppCalendar, expandIcs, inspectIcs } from "@/lib/calendar/ics";
import {
  addAppCalendar,
  addImported,
  deleteEvent,
  downloadJson,
  filesFromSnapshot,
  removeCalendar,
  renameCalendar,
  restorePayload,
  saveEvent,
  setColor,
  setEnabled,
  setTheme,
  setView,
  updateFeed,
  useCal,
} from "@/lib/calendar/store";
import { colorFor, isEnabled, type AppEvent, type Occurrence, type ViewMode } from "@/lib/calendar/types";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Something went wrong.";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || "Feed";
  }
}

function draftFromOccurrence(event: Occurrence): EventDraft {
  const endForInput = event.allDay ? addDays(event.end, -1) : event.end;
  const endDate = dateInputValue(endForInput.getTime() < event.start.getTime() ? event.start : endForInput);
  return {
    id: event.eventId,
    calendarId: event.calendarId,
    title: event.title,
    date: dateInputValue(event.start),
    endDate,
    startTime: event.allDay ? "09:00" : timeInputValue(event.start),
    endTime: event.allDay ? "10:00" : timeInputValue(event.end),
    allDay: event.allDay,
    location: event.location,
    notes: event.notes,
    readOnly: event.readOnly,
  };
}

function draftForCreate(calendarId: string, start: Date, allDay: boolean): EventDraft {
  const end = allDay ? start : new Date(start.getTime() + 60 * 60 * 1000);
  return {
    id: crypto.randomUUID(),
    calendarId,
    title: "",
    date: dateInputValue(start),
    endDate: dateInputValue(allDay ? start : end),
    startTime: allDay ? "09:00" : timeInputValue(start),
    endTime: allDay ? "10:00" : timeInputValue(end),
    allDay,
    location: "",
    notes: "",
    readOnly: false,
  };
}

function toAppEvent(draft: EventDraft): AppEvent {
  if (draft.allDay) {
    const end = addDays(combineDateTime(draft.endDate, "00:00"), 1);
    return {
      id: draft.id,
      title: draft.title,
      start: draft.date,
      end: dateInputValue(end),
      allDay: true,
      location: draft.location.trim(),
      notes: draft.notes.trim(),
    };
  }
  const start = combineDateTime(draft.date, draft.startTime);
  let end = combineDateTime(draft.date, draft.endTime);
  if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    id: draft.id,
    title: draft.title,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: false,
    location: draft.location.trim(),
    notes: draft.notes.trim(),
  };
}

export function CalendarApp() {
  const { imported, appCals, prefs } = useCal();
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [banner, setBanner] = useState("");
  const [busyId, setBusyId] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [draftOrigin, setDraftOrigin] = useState("");

  const rows: CalendarRow[] = [
    ...appCals.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      kind: "app" as const,
      detail: `${calendar.events.length} event${calendar.events.length === 1 ? "" : "s"}`,
    })),
    ...imported.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      kind: calendar.type,
      detail: calendar.type === "feed" ? hostOf(calendar.url) : calendar.path || "ICS file",
    })),
  ];

  const colorOf = (id: string) => colorFor(prefs, id, Math.max(rows.findIndex((row) => row.id === id), 0));
  const days = visibleDays(prefs.view, anchor);
  const range = rangeFor(days);
  const rangeKey = `${range.start.getTime()}-${range.end.getTime()}`;

  const occurrences = useMemo(() => {
    const [startMs, endMs] = rangeKey.split("-").map(Number);
    const start = new Date(startMs);
    const end = new Date(endMs);
    const fromFiles = imported.flatMap((calendar) => expandIcs(calendar.ics, calendar.id, start, end));
    const fromApp = appCals.flatMap((calendar) => expandAppCalendar(calendar, start, end));
    return [...fromFiles, ...fromApp].filter((event) => isEnabled(prefs, event.calendarId));
  }, [imported, appCals, prefs, rangeKey]);

  const ensureAppCalendar = () => {
    if (appCals[0]) return appCals[0].id;
    return addAppCalendar("My calendar");
  };

  const openCreate = (start: Date, allDay: boolean) => {
    const when = new Date(allDay ? startOfDay(start) : start);
    if (!allDay && when.getHours() === 0 && when.getMinutes() === 0) when.setHours(9, 0, 0, 0);
    const calendarId = ensureAppCalendar();
    const next = draftForCreate(calendarId, when, allDay);
    setDraftOrigin(calendarId);
    setDraft(next);
  };

  const openEvent = (event: Occurrence) => {
    setDraftOrigin(event.calendarId);
    setDraft(draftFromOccurrence(event));
  };

  const refreshFeed = async (id: string) => {
    const calendar = imported.find((item) => item.id === id);
    if (!calendar || calendar.type !== "feed" || !calendar.url) return;
    setBusyId(id);
    try {
      const result = await fetchCalendarFeed({ data: { url: calendar.url } });
      updateFeed(id, result.ics);
      setBanner(`Updated ${calendar.name}.`);
    } catch (error) {
      setBanner(errorMessage(error));
    } finally {
      setBusyId("");
    }
  };

  const changeView = (view: ViewMode) => setView(view);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-paper text-ink">
      <header className="flex flex-col gap-3 border-b border-line px-3 py-3 md:px-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-paper-2 md:hidden"
            aria-label="Calendars"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <p className="font-display text-2xl text-ink">Meridian</p>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAnchor(startOfDay(new Date()))}
              className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium text-ink hover:bg-paper-2"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => openCreate(anchor, false)}
              className="inline-flex h-11 items-center gap-1 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg"
            >
              <Plus className="size-4" />
              Event
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto font-display text-xl text-ink md:text-2xl">{periodLabel(prefs.view, anchor)}</h1>
          <div className="flex items-center">
            <button
              type="button"
              aria-label="Previous"
              onClick={() => setAnchor(shiftAnchor(prefs.view, anchor, -1))}
              className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-paper-2"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => setAnchor(shiftAnchor(prefs.view, anchor, 1))}
              className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-paper-2"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
          <div className="flex rounded-lg bg-paper-2 p-1">
            {(["day", "week", "month"] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={prefs.view === view}
                onClick={() => changeView(view)}
                className={`h-11 rounded-md px-3 text-sm font-medium capitalize ${
                  prefs.view === view ? "card-shadow bg-card text-ink" : "text-ink-soft"
                }`}
              >
                {view}
              </button>
            ))}
          </div>
        </div>
      </header>
      {banner && (
        <div className="flex items-start gap-3 border-b border-line bg-paper-2 px-4 py-2 text-sm text-ink" role="status">
          <p className="min-w-0 flex-1 text-pretty">{banner}</p>
          <button type="button" className="h-11 shrink-0 px-2 text-ink-soft" onClick={() => setBanner("")}>
            Dismiss
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close calendars"
            className="fixed inset-0 z-30 bg-ink/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <Sidebar
          open={sidebarOpen}
          rows={rows}
          prefs={prefs}
          busyId={busyId}
          onClose={() => setSidebarOpen(false)}
          onToggle={setEnabled}
          onColor={setColor}
          onRename={renameCalendar}
          onRemove={removeCalendar}
          onRefresh={(id) => void refreshFeed(id)}
          onAdd={() => setAdding(true)}
          onTheme={setTheme}
          onDownload={(name) => {
            if (name === "python") {
              const link = document.createElement("a");
              link.href = "/calendar_app.py";
              link.download = "calendar_app.py";
              link.click();
              return;
            }
            const files = filesFromSnapshot();
            downloadJson(name, files[name]);
          }}
          onRestore={(file) => {
            void file.text().then((text) => {
              try {
                setBanner(restorePayload(JSON.parse(text) as unknown));
              } catch (error) {
                setBanner(errorMessage(error));
              }
            });
          }}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          {prefs.view === "month" ? (
            <MonthView
              days={days}
              anchor={anchor}
              occurrences={occurrences}
              colorOf={colorOf}
              onSelectDay={(day) => setAnchor(startOfDay(day))}
              onOpen={openEvent}
              onCreateAt={openCreate}
            />
          ) : (
            <TimeGrid
              days={days}
              anchor={anchor}
              occurrences={occurrences}
              colorOf={colorOf}
              onSelectDay={(day) => setAnchor(startOfDay(day))}
              onOpen={openEvent}
              onCreateAt={(start) => openCreate(start, false)}
            />
          )}
        </main>
      </div>
      {adding && (
        <AddCalendarDialog
          onClose={() => setAdding(false)}
          onBlank={(name) => {
            addAppCalendar(name);
            setBanner(`Created ${name.trim()}.`);
          }}
          onFile={async (file, name) => {
            if (file.size > 4_000_000) throw new Error("That file is too large.");
            const ics = await file.text();
            const inspected = inspectIcs(ics);
            if (!inspected.ok) throw new Error(inspected.error);
            const calendarName = name.trim() || inspected.name || file.name.replace(/\.ics$/i, "");
            addImported({
              id: crypto.randomUUID(),
              name: calendarName,
              type: "file",
              path: file.name,
              url: "",
              ics,
              fetchedAt: new Date().toISOString(),
            });
            setBanner(
              inspected.eventCount
                ? `Added ${calendarName} · ${inspected.eventCount} event${inspected.eventCount === 1 ? "" : "s"}.`
                : `Added ${calendarName}. No events were found in the file.`,
            );
          }}
          onFeed={async (url, name) => {
            const normalized = normalizeFeedUrl(url);
            const result = await fetchCalendarFeed({ data: { url: normalized } });
            const inspected = inspectIcs(result.ics);
            if (!inspected.ok) throw new Error(inspected.error);
            const existing = imported.find((calendar) => calendar.type === "feed" && calendar.url === normalized);
            const calendarName = name.trim() || inspected.name || hostOf(normalized);
            if (existing) {
              if (name.trim()) renameCalendar(existing.id, calendarName);
              updateFeed(existing.id, result.ics);
              setBanner(`Updated ${calendarName}.`);
              return;
            }
            addImported({
              id: crypto.randomUUID(),
              name: calendarName,
              type: "feed",
              path: "",
              url: normalized,
              ics: result.ics,
              fetchedAt: new Date().toISOString(),
            });
            setBanner(`Subscribed to ${calendarName}.`);
          }}
        />
      )}
      {draft && (
        <EventDialog
          key={draft.id}
          draft={draft}
          calendars={appCals.map((calendar) => ({ id: calendar.id, name: calendar.name }))}
          sourceName={rows.find((row) => row.id === draft.calendarId)?.name ?? "Calendar"}
          onClose={() => setDraft(null)}
          onSave={(next) => {
            if (draftOrigin && draftOrigin !== next.calendarId) deleteEvent(draftOrigin, next.id);
            saveEvent(next.calendarId, toAppEvent(next));
            setAnchor(startOfDay(combineDateTime(next.date, "00:00")));
            setDraft(null);
          }}
          onDelete={() => {
            deleteEvent(draftOrigin || draft.calendarId, draft.id);
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}
