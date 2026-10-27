import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { inspectIcs } from "@/lib/calendar/ics";
import type { Occurrence } from "@/lib/calendar/types";

const fieldClass = "h-11 w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink";
const labelClass = "mb-1 block text-sm font-medium text-ink";

export type EventDraft = {
  id: string;
  calendarId: string;
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  notes: string;
  readOnly: boolean;
};

function Shell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content className="card-shadow fixed inset-0 z-50 overflow-y-auto bg-card p-5 focus:outline-none md:inset-auto md:top-1/2 md:left-1/2 md:max-h-screen md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:p-6">
          <div className="mb-4 flex items-start gap-3">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-2xl text-ink">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-ink-soft">{description}</Dialog.Description>
            </div>
            <Dialog.Close className="ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-ink hover:bg-paper-2" aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AddCalendarDialog({
  onClose,
  onFile,
  onFeed,
  onBlank,
}: {
  onClose: () => void;
  onFile: (file: File, name: string) => Promise<void>;
  onFeed: (url: string, name: string) => Promise<void>;
  onBlank: (name: string) => void;
}) {
  const [mode, setMode] = useState<"feed" | "file" | "blank">("feed");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setError("");
    setPending(true);
    try {
      if (mode === "blank") {
        if (!name.trim()) {
          setError("Name the calendar.");
          return;
        }
        onBlank(name);
        onClose();
        return;
      }
      if (mode === "feed") {
        await onFeed(url, name);
        onClose();
        return;
      }
      if (!file) {
        setError("Choose an .ics file.");
        return;
      }
      await onFile(file, name);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't add that calendar.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Shell
      title="Add a calendar"
      description="Import an iCal file, subscribe to a Google or Apple feed, or start a blank calendar."
      onClose={onClose}
    >
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-paper-2 p-1">
        {(
          [
            ["feed", "Feed"],
            ["file", "File"],
            ["blank", "Blank"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            className={`h-11 rounded-md text-sm font-medium ${mode === id ? "bg-card text-ink card-shadow" : "text-ink-soft"}`}
            onClick={() => {
              setMode(id);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <label className={labelClass} htmlFor="cal-name">
        Name
      </label>
      <input
        id="cal-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={mode === "blank" ? "Personal" : "Optional — taken from the calendar"}
        className={`${fieldClass} mb-4`}
      />
      {mode === "feed" && (
        <>
          <label className={labelClass} htmlFor="cal-url">
            Feed link
          </label>
          <input
            id="cal-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https:// or webcal://"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            className={`${fieldClass} mb-2`}
          />
          <p className="mb-4 text-sm text-pretty text-ink-soft">
            Google Calendar: Settings, your calendar, Integrate calendar, Secret address in iCal format. Apple Calendar: the share link that opens as an .ics feed.
          </p>
        </>
      )}
      {mode === "file" && (
        <div className="mb-4">
          <label className={labelClass} htmlFor="cal-file">
            iCal file
          </label>
          <input
            id="cal-file"
            type="file"
            accept=".ics,.ical,text/calendar"
            className="block w-full text-sm text-ink file:mr-3 file:h-11 file:rounded-lg file:border-0 file:bg-paper-2 file:px-3 file:text-sm file:font-medium file:text-ink"
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              setFile(next);
              if (!next) return;
              void next.text().then((text) => {
                const inspected = inspectIcs(text);
                if (inspected.ok && inspected.name && !name.trim()) setName(inspected.name);
              });
            }}
          />
          {file && <p className="mt-2 text-sm text-ink-soft">{file.name}</p>}
        </div>
      )}
      {error && (
        <p className="mb-3 text-sm text-accent" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => void submit()}
        className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent text-sm font-medium text-accent-fg disabled:opacity-60"
      >
        {pending ? "Adding…" : mode === "blank" ? "Create calendar" : "Add calendar"}
      </button>
    </Shell>
  );
}

export function EventDialog({
  draft,
  calendars,
  sourceName,
  onClose,
  onSave,
  onDelete,
}: {
  draft: EventDraft;
  calendars: { id: string; name: string }[];
  sourceName: string;
  onClose: () => void;
  onSave: (draft: EventDraft) => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [error, setError] = useState("");

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  if (draft.readOnly) {
    return (
      <Shell title={draft.title || "Event"} description={`From ${sourceName}. Imported events stay read-only.`} onClose={onClose}>
        <ReadOnlyEvent draft={draft} />
      </Shell>
    );
  }

  return (
    <Shell
      title={draft.title ? "Edit event" : "New event"}
      description="Events you create are saved with this calendar."
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.title.trim()) {
            setError("Add a title.");
            return;
          }
          if (!form.allDay && form.endTime <= form.startTime && form.endDate <= form.date) {
            setError("End time needs to be after the start.");
            return;
          }
          if (form.allDay && form.endDate < form.date) {
            setError("End date needs to be on or after the start.");
            return;
          }
          onSave({ ...form, title: form.title.trim() });
        }}
      >
        <label className={labelClass} htmlFor="event-title">
          Title
        </label>
        <input
          id="event-title"
          value={form.title}
          onChange={(event) => set("title", event.target.value)}
          className={`${fieldClass} mb-3`}
          required
        />
        <label className={labelClass} htmlFor="event-cal">
          Calendar
        </label>
        <select
          id="event-cal"
          value={form.calendarId}
          onChange={(event) => set("calendarId", event.target.value)}
          className={`${fieldClass} mb-3`}
        >
          {calendars.map((calendar) => (
            <option key={calendar.id} value={calendar.id}>
              {calendar.name}
            </option>
          ))}
        </select>
        <label className="mb-3 flex min-h-11 items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.allDay}
            onChange={(event) => set("allDay", event.target.checked)}
            className="size-4 accent-accent"
          />
          All day
        </label>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="event-date">
              Start
            </label>
            <input
              id="event-date"
              type="date"
              value={form.date}
              onChange={(event) => {
                const value = event.target.value;
                setForm((current) => ({
                  ...current,
                  date: value,
                  endDate: current.endDate < value ? value : current.endDate,
                }));
              }}
              className={fieldClass}
              required
            />
          </div>
          {form.allDay ? (
            <div>
              <label className={labelClass} htmlFor="event-end-date">
                End
              </label>
              <input
                id="event-end-date"
                type="date"
                value={form.endDate}
                min={form.date}
                onChange={(event) => set("endDate", event.target.value)}
                className={fieldClass}
                required
              />
            </div>
          ) : (
            <div>
              <label className={labelClass} htmlFor="event-start-time">
                Time
              </label>
              <input
                id="event-start-time"
                type="time"
                value={form.startTime}
                onChange={(event) => set("startTime", event.target.value)}
                className={fieldClass}
                required
              />
            </div>
          )}
        </div>
        {!form.allDay && (
          <div className="mb-3">
            <label className={labelClass} htmlFor="event-end-time">
              Ends
            </label>
            <input
              id="event-end-time"
              type="time"
              value={form.endTime}
              onChange={(event) => set("endTime", event.target.value)}
              className={fieldClass}
              required
            />
          </div>
        )}
        <label className={labelClass} htmlFor="event-where">
          Location
        </label>
        <input
          id="event-where"
          value={form.location}
          onChange={(event) => set("location", event.target.value)}
          className={`${fieldClass} mb-3`}
        />
        <label className={labelClass} htmlFor="event-notes">
          Notes
        </label>
        <textarea
          id="event-notes"
          value={form.notes}
          onChange={(event) => set("notes", event.target.value)}
          rows={3}
          className="mb-3 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
        />
        {error && (
          <p className="mb-3 text-sm text-accent" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          {draft.title && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium text-accent"
            >
              Delete
            </button>
          )}
          <button
            type="submit"
            className="ml-auto inline-flex h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg"
          >
            Save
          </button>
        </div>
      </form>
    </Shell>
  );
}

function ReadOnlyEvent({ draft }: { draft: EventDraft }) {
  const when = draft.allDay
    ? draft.date === draft.endDate
      ? format(new Date(`${draft.date}T00:00:00`), "EEEE, MMMM d")
      : `${format(new Date(`${draft.date}T00:00:00`), "MMM d")} – ${format(new Date(`${draft.endDate}T00:00:00`), "MMM d, yyyy")}`
    : `${format(new Date(`${draft.date}T${draft.startTime}`), "EEE, MMM d, h:mm a")} – ${format(new Date(`${draft.date}T${draft.endTime}`), "h:mm a")}`;
  return (
    <dl className="flex flex-col gap-3 text-sm">
      <div>
        <dt className="text-ink-soft">When</dt>
        <dd className="text-ink">{when}</dd>
      </div>
      {draft.location && (
        <div>
          <dt className="text-ink-soft">Where</dt>
          <dd className="text-ink">{draft.location}</dd>
        </div>
      )}
      {draft.notes && (
        <div>
          <dt className="text-ink-soft">Notes</dt>
          <dd className="whitespace-pre-wrap text-pretty text-ink">{draft.notes}</dd>
        </div>
      )}
    </dl>
  );
}

export function formatOccurrenceWhen(event: Occurrence): string {
  if (event.allDay) return "All day";
  return format(event.start, "h:mm a");
}
