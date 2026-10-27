import ICAL from "ical.js";
import type { AppCalendar, Occurrence } from "@/lib/calendar/types";

const HARD_CAP = 25000;

export type InspectResult =
  | { ok: true; name: string; eventCount: number }
  | { ok: false; error: string };

function componentFrom(ics: string): ICAL.Component {
  const cleaned = ics.replace(/^\uFEFF/, "").trim();
  if (!/BEGIN:VCALENDAR/i.test(cleaned.slice(0, 4000))) {
    throw new Error("This is not an iCalendar file.");
  }
  return new ICAL.Component(ICAL.parse(cleaned));
}

export function inspectIcs(ics: string): InspectResult {
  try {
    const comp = componentFrom(ics);
    const rawName = comp.getFirstPropertyValue("x-wr-calname");
    const events = comp.getAllSubcomponents("vevent");
    const masters = events.filter((item) => !item.hasProperty("recurrence-id"));
    return {
      ok: true,
      name: typeof rawName === "string" && rawName.trim() ? rawName.trim() : "",
      eventCount: masters.length,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not read that calendar." };
  }
}

function asDate(time: ICAL.Time, allDay: boolean): Date {
  if (allDay || time.isDate) {
    return new Date(time.year, time.month - 1, time.day, 0, 0, 0, 0);
  }
  return time.toJSDate();
}

function ensureEnd(start: Date, end: Date, allDay: boolean): Date {
  if (end.getTime() > start.getTime()) return end;
  if (allDay) return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return new Date(start.getTime() + 60 * 60 * 1000);
}

export function expandIcs(
  ics: string,
  calendarId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence[] {
  let comp: ICAL.Component;
  try {
    comp = componentFrom(ics);
  } catch {
    return [];
  }

  const occurrences: Occurrence[] = [];
  const vevents = comp.getAllSubcomponents("vevent");

  for (const vevent of vevents) {
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(vevent);
      if (event.isRecurrenceException()) continue;
      if (!event.startDate) continue;
    } catch {
      continue;
    }

    const titleValue = event.summary;
    const title = typeof titleValue === "string" && titleValue.trim() ? titleValue.trim() : "(No title)";
    const location = typeof event.location === "string" ? event.location : "";
    const notes = typeof event.description === "string" ? event.description : "";
    const uid = event.uid || `${calendarId}-${occurrences.length}`;

    const push = (startTime: ICAL.Time, endTime: ICAL.Time, suffix: string) => {
      const allDay = Boolean(startTime.isDate);
      const start = asDate(startTime, allDay);
      const end = ensureEnd(start, asDate(endTime, allDay), allDay);
      if (end.getTime() <= rangeStart.getTime() || start.getTime() >= rangeEnd.getTime()) return;
      occurrences.push({
        key: `${calendarId}:${uid}:${suffix}`,
        calendarId,
        eventId: uid,
        title,
        start,
        end,
        allDay,
        location,
        notes,
        readOnly: true,
      });
    };

    try {
      if (event.isRecurring()) {
        const iterator = event.iterator();
        let guard = 0;
        let next = iterator.next();
        while (next && guard < HARD_CAP) {
          guard += 1;
          const details = event.getOccurrenceDetails(next);
          const startStamp = details.startDate.isDate
            ? new Date(details.startDate.year, details.startDate.month - 1, details.startDate.day).getTime()
            : details.startDate.toJSDate().getTime();
          if (startStamp >= rangeEnd.getTime()) break;
          push(details.startDate, details.endDate, details.startDate.toString());
          if (iterator.complete) break;
          next = iterator.next();
        }
      } else {
        push(event.startDate, event.endDate, "once");
      }
    } catch {
      continue;
    }
  }

  return occurrences;
}

function parseDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year || 0, (month || 1) - 1, day || 1);
}

export function expandAppCalendar(calendar: AppCalendar, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const event of calendar.events) {
    const start = event.allDay ? parseDay(event.start) : new Date(event.start);
    const end = event.allDay ? parseDay(event.end) : new Date(event.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end.getTime() <= rangeStart.getTime() || start.getTime() >= rangeEnd.getTime()) continue;
    occurrences.push({
      key: `${calendar.id}:${event.id}`,
      calendarId: calendar.id,
      eventId: event.id,
      title: event.title.trim() || "(No title)",
      start,
      end,
      allDay: event.allDay,
      location: event.location,
      notes: event.notes,
      readOnly: false,
    });
  }
  return occurrences;
}
