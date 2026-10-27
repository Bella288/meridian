import { format, isSameDay, isSameMonth, isToday, setHours } from "date-fns";
import { useEffect, useRef } from "react";
import { HOUR_PX, eventsOnDay, layoutTimed } from "@/lib/calendar/dates";
import type { Occurrence } from "@/lib/calendar/types";
import { textOn } from "@/lib/calendar/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type ViewProps = {
  days: Date[];
  anchor: Date;
  occurrences: Occurrence[];
  colorOf: (calendarId: string) => string;
  onSelectDay: (day: Date) => void;
  onOpen: (event: Occurrence) => void;
  onCreateAt: (start: Date, allDay: boolean) => void;
};

function EventButton({
  event,
  color,
  onOpen,
  time,
}: {
  event: Occurrence;
  color: string;
  onOpen: (event: Occurrence) => void;
  time?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(click) => {
        click.stopPropagation();
        onOpen(event);
      }}
      className="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs font-medium"
      style={{ backgroundColor: color, color: textOn(color) }}
    >
      {time && !event.allDay ? `${format(event.start, "h:mm")} ` : ""}
      {event.title}
    </button>
  );
}

export function MonthView({
  days,
  anchor,
  occurrences,
  colorOf,
  onSelectDay,
  onOpen,
  onCreateAt,
}: ViewProps) {
  const month = anchor;
  const selected = eventsOnDay(occurrences, anchor);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-line bg-paper">
          {WEEKDAYS.map((label) => (
            <div key={label} className="px-1 py-2 text-center text-xs font-medium text-ink-soft md:px-2 md:text-left">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const events = eventsOnDay(occurrences, day);
            const shown = events.slice(0, 3);
            const extra = events.length - shown.length;
            const outside = !isSameMonth(day, month);
            const selectedDay = isSameDay(day, anchor);
            return (
              <div
                key={day.toISOString()}
                className={`min-h-16 border-b border-r border-line p-1 md:min-h-24 ${selectedDay ? "bg-paper-2" : "bg-card"} ${outside ? "opacity-60" : ""}`}
                onClick={() => onSelectDay(day)}
              >
                <button
                  type="button"
                  className="inline-flex size-11 items-center justify-center"
                  aria-label={format(day, "EEEE, MMMM d")}
                  aria-pressed={selectedDay}
                  onClick={(click) => {
                    click.stopPropagation();
                    onSelectDay(day);
                  }}
                >
                  <span
                    className={`inline-flex size-7 items-center justify-center rounded-full text-sm tabular-nums ${
                      isToday(day) ? "bg-accent font-medium text-accent-fg" : "text-ink"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                </button>
                <div className="flex flex-col gap-0.5">
                  {shown.map((event) => (
                    <EventButton
                      key={event.key}
                      event={event}
                      color={colorOf(event.calendarId)}
                      onOpen={onOpen}
                      time
                    />
                  ))}
                  {extra > 0 && (
                    <button
                      type="button"
                      className="px-1.5 text-left text-xs font-medium text-ink-soft"
                      onClick={(click) => {
                        click.stopPropagation();
                        onSelectDay(day);
                        document.getElementById("day-agenda")?.scrollIntoView({ block: "nearest" });
                      }}
                    >
                      +{extra} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <section id="day-agenda" className="max-h-56 shrink-0 overflow-auto border-t border-line bg-paper px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="font-display text-lg text-ink">{format(anchor, "EEEE, MMMM d")}</h2>
          <button
            type="button"
            className="inline-flex h-11 items-center rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg"
            onClick={() => onCreateAt(anchor, false)}
          >
            Add event
          </button>
        </div>
        {selected.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing scheduled.</p>
        ) : (
          <ul className="flex flex-col">
            {selected.map((event) => (
              <li key={event.key}>
                <button
                  type="button"
                  onClick={() => onOpen(event)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-1 text-left hover:bg-paper-2"
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(event.calendarId) }} />
                  <span className="w-24 shrink-0 text-sm tabular-nums text-ink-soft">
                    {event.allDay ? "All day" : format(event.start, "h:mm a")}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium text-ink">{event.title}</span>
                  {event.location && (
                    <span className="ml-auto hidden truncate text-sm text-ink-soft sm:block">{event.location}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function TimeGrid({
  days,
  anchor,
  occurrences,
  colorOf,
  onSelectDay,
  onOpen,
  onCreateAt,
}: ViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const dayKey = days.map((day) => day.toDateString()).join();

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = 7 * HOUR_PX;
  }, [dayKey]);

  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const columns = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
      <div className={days.length > 1 ? "min-w-3xl" : "min-w-full"}>
        <div
          className="sticky top-0 z-20 grid border-b border-line bg-paper"
          style={{ gridTemplateColumns: columns }}
        >
          <div />
          {days.map((day) => {
            const selected = isSameDay(day, anchor);
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => onSelectDay(day)}
                className={`min-h-16 px-2 py-2 text-left ${selected ? "bg-paper-2" : ""}`}
              >
                <div className="text-xs font-medium text-ink-soft">{format(day, "EEE")}</div>
                <div
                  className={`mt-1 inline-flex size-8 items-center justify-center rounded-full text-sm tabular-nums ${
                    isToday(day) ? "bg-accent font-medium text-accent-fg" : "text-ink"
                  }`}
                >
                  {format(day, "d")}
                </div>
              </button>
            );
          })}
        </div>
        <div className="grid border-b border-line" style={{ gridTemplateColumns: columns }}>
          <div className="px-2 py-2 text-xs text-ink-soft">All day</div>
          {days.map((day) => {
            const allDay = eventsOnDay(occurrences, day).filter((event) => event.allDay);
            return (
              <div key={day.toISOString()} className="flex flex-col gap-0.5 border-l border-line p-1">
                {allDay.map((event) => (
                  <EventButton key={event.key} event={event} color={colorOf(event.calendarId)} onOpen={onOpen} />
                ))}
              </div>
            );
          })}
        </div>
        <div className="relative grid" style={{ gridTemplateColumns: columns, height: HOUR_PX * 24 }}>
          <div className="relative">
            {hours.map((hour) =>
              hour === 0 ? null : (
                <div
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-ink-soft"
                  style={{ top: hour * HOUR_PX }}
                >
                  {format(setHours(days[0] ?? new Date(), hour), "h a")}
                </div>
              ),
            )}
          </div>
          {days.map((day) => {
            const placed = layoutTimed(occurrences, day);
            const now = new Date();
            const showNow = isToday(day);
            const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX;
            return (
              <div
                key={day.toISOString()}
                className="relative border-l border-line"
                onClick={(click) => {
                  if ((click.target as HTMLElement).closest("button")) return;
                  const bounds = click.currentTarget.getBoundingClientRect();
                  const y = Math.max(0, click.clientY - bounds.top);
                  const rounded = Math.floor(((y / HOUR_PX) * 60) / 30) * 30;
                  const clamped = Math.max(0, Math.min(23 * 60 + 30, rounded));
                  const start = new Date(day);
                  start.setHours(Math.floor(clamped / 60), clamped % 60, 0, 0);
                  onCreateAt(start, false);
                }}
              >
                {hours.map((hour) => (
                  <div key={hour} className="border-t border-line" style={{ height: HOUR_PX }} />
                ))}
                {placed.map((item) => (
                  <button
                    key={item.event.key}
                    type="button"
                    onClick={(click) => {
                      click.stopPropagation();
                      onOpen(item.event);
                    }}
                    className="absolute z-10 overflow-hidden rounded px-1.5 py-0.5 text-left text-xs font-medium"
                    style={{
                      top: item.top,
                      height: item.height,
                      left: `calc(${(item.col / item.cols) * 100}% + 2px)`,
                      width: `calc(${100 / item.cols}% - 4px)`,
                      backgroundColor: colorOf(item.event.calendarId),
                      color: textOn(colorOf(item.event.calendarId)),
                    }}
                  >
                    <span className="block truncate">{item.event.title}</span>
                    {item.height > 36 && (
                      <span className="block truncate opacity-80">{format(item.event.start, "h:mm a")}</span>
                    )}
                  </button>
                ))}
                {showNow && (
                  <div className="pointer-events-none absolute right-0 left-0 z-20" style={{ top: nowTop }}>
                    <div className="h-px bg-accent" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
