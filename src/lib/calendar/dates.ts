import {
  addDays,
  addMonths,
  addWeeks,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { Occurrence, ViewMode } from "@/lib/calendar/types";

export const HOUR_PX = 56;

export function visibleDays(view: ViewMode, anchor: Date): Date[] {
  if (view === "month") {
    const gridStart = startOfWeek(startOfMonth(anchor));
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  return [startOfDay(anchor)];
}

export function rangeFor(days: Date[]): { start: Date; end: Date } {
  return { start: startOfDay(days[0] ?? new Date()), end: addDays(startOfDay(days[days.length - 1] ?? new Date()), 1) };
}

export function shiftAnchor(view: ViewMode, anchor: Date, dir: -1 | 1): Date {
  if (view === "month") return addMonths(anchor, dir);
  if (view === "week") return addWeeks(anchor, dir);
  return addDays(anchor, dir);
}

export function periodLabel(view: ViewMode, anchor: Date): string {
  if (view === "day") return format(anchor, "EEEE, MMMM d");
  if (view === "month") return format(anchor, "MMMM yyyy");
  const start = startOfWeek(anchor);
  const end = addDays(start, 6);
  if (start.getFullYear() !== end.getFullYear()) {
    return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`;
}

export function coversDay(event: Occurrence, day: Date): boolean {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  return event.start.getTime() < dayEnd && event.end.getTime() > dayStart;
}

export function eventsOnDay(events: Occurrence[], day: Date): Occurrence[] {
  return events
    .filter((event) => coversDay(event, day))
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title);
    });
}

export type PlacedEvent = {
  event: Occurrence;
  top: number;
  height: number;
  col: number;
  cols: number;
};

export function layoutTimed(events: Occurrence[], day: Date): PlacedEvent[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const timed = events.filter((event) => !event.allDay && coversDay(event, day));
  const items = timed
    .map((event) => {
      const start = Math.max(event.start.getTime(), dayStart);
      const end = Math.min(event.end.getTime(), dayEnd);
      const startMin = (start - dayStart) / 60000;
      const endMin = Math.max(startMin + 20, (end - dayStart) / 60000);
      return { event, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const placed: PlacedEvent[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const columns: typeof items[] = [];
    for (const item of cluster) {
      let index = columns.findIndex((column) => column.every((entry) => entry.endMin <= item.startMin));
      if (index === -1) {
        index = columns.length;
        columns.push([]);
      }
      columns[index].push(item);
    }
    const cols = Math.max(columns.length, 1);
    for (let col = 0; col < columns.length; col += 1) {
      for (const item of columns[col]) {
        placed.push({
          event: item.event,
          top: (item.startMin / 60) * HOUR_PX,
          height: Math.max(((item.endMin - item.startMin) / 60) * HOUR_PX - 2, 18),
          col,
          cols,
        });
      }
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of items) {
    if (cluster.length && item.startMin >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();
  return placed;
}

export function combineDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year || 0, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0, 0);
}

export function dateInputValue(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function timeInputValue(date: Date): string {
  return format(date, "HH:mm");
}
