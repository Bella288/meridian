import { Download, Moon, Plus, RefreshCw, Sun, Trash2 } from "lucide-react";
import { useState } from "react";
import { CAL_COLORS, type Prefs, type ThemeMode } from "@/lib/calendar/types";

export type CalendarRow = {
  id: string;
  name: string;
  kind: "file" | "feed" | "app";
  detail: string;
};

export function Sidebar({
  open,
  rows,
  prefs,
  busyId,
  onClose,
  onToggle,
  onColor,
  onRename,
  onRemove,
  onRefresh,
  onAdd,
  onTheme,
  onDownload,
  onRestore,
}: {
  open: boolean;
  rows: CalendarRow[];
  prefs: Prefs;
  busyId: string;
  onClose: () => void;
  onToggle: (id: string, on: boolean) => void;
  onColor: (id: string, color: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onRefresh: (id: string) => void;
  onAdd: () => void;
  onTheme: (theme: ThemeMode) => void;
  onDownload: (name: "cals.json" | "pref.json" | "app-cals.json" | "python") => void;
  onRestore: (file: File) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <aside
      className={`${open ? "flex" : "hidden md:flex"} fixed inset-y-0 left-0 z-40 w-72 flex-col border-r border-line bg-paper md:static`}
    >
      <div className="flex items-center gap-2 px-4 pt-4 md:hidden">
        <p className="font-display text-xl text-ink">Calendars</p>
        <button type="button" onClick={onClose} className="ml-auto inline-flex h-11 items-center px-2 text-sm text-ink-soft">
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-2 hidden items-center justify-between px-1 md:flex">
          <h2 className="text-xs font-medium tracking-wide text-ink-soft uppercase">Calendars</h2>
        </div>
        {rows.length === 0 && <p className="px-2 py-3 text-sm text-ink-soft">No calendars yet.</p>}
        <ul className="flex flex-col">
          {rows.map((row) => {
            const enabled = prefs.enabled[row.id] !== false;
            const color = prefs.colors[row.id] ?? CAL_COLORS[0].hex;
            const expanded = openId === row.id;
            return (
              <li key={row.id} className="border-b border-line">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={enabled}
                    aria-label={`${enabled ? "Hide" : "Show"} ${row.name}`}
                    onClick={() => onToggle(row.id, !enabled)}
                    className="inline-flex size-11 items-center justify-center"
                  >
                    <span
                      className="size-4 rounded border"
                      style={{
                        backgroundColor: enabled ? color : "transparent",
                        borderColor: color,
                      }}
                    />
                  </button>
                  <button
                    type="button"
                    className="min-w-0 flex-1 py-2 text-left"
                    aria-expanded={expanded}
                    onClick={() => setOpenId(expanded ? null : row.id)}
                  >
                    <span className={`block truncate text-sm font-medium ${enabled ? "text-ink" : "text-ink-soft"}`}>
                      {row.name}
                    </span>
                    <span className="block truncate text-xs text-ink-soft">
                      {row.kind === "app" ? "Created here" : row.kind === "feed" ? "Feed" : "File"} · {row.detail}
                    </span>
                  </button>
                </div>
                {expanded && (
                  <CalendarEditor
                    row={row}
                    color={color}
                    busy={busyId === row.id}
                    onColor={(next) => onColor(row.id, next)}
                    onRename={(name) => onRename(row.id, name)}
                    onRemove={() => {
                      onRemove(row.id);
                      setOpenId(null);
                    }}
                    onRefresh={() => onRefresh(row.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={onAdd}
          className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-accent-fg"
        >
          <Plus className="size-4" />
          Add calendar
        </button>
      </div>
      <div className="border-t border-line p-3">
        <button
          type="button"
          onClick={() => onTheme(prefs.theme === "dark" ? "light" : "dark")}
          className="inline-flex h-11 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-ink hover:bg-paper-2"
        >
          {prefs.theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {prefs.theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <details className="mt-1">
          <summary className="flex h-11 cursor-pointer items-center px-2 text-sm font-medium text-ink">
            Saved files
          </summary>
          <p className="px-2 pb-2 text-sm text-pretty text-ink-soft">
            Kept in this browser as cals.json, pref.json, and app-cals.json. The desktop script uses the same names in your Documents folder.
          </p>
          <div className="flex flex-col">
            {(["cals.json", "pref.json", "app-cals.json"] as const).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onDownload(name)}
                className="inline-flex h-11 items-center gap-2 rounded-lg px-2 text-left text-sm text-ink hover:bg-paper-2"
              >
                <Download className="size-4 text-ink-soft" />
                {name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onDownload("python")}
              className="inline-flex h-11 items-center gap-2 rounded-lg px-2 text-left text-sm text-ink hover:bg-paper-2"
            >
              <Download className="size-4 text-ink-soft" />
              Python desktop app
            </button>
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-ink hover:bg-paper-2">
              Restore a file
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onRestore(file);
                }}
              />
            </label>
          </div>
        </details>
      </div>
    </aside>
  );
}

function CalendarEditor({
  row,
  color,
  busy,
  onColor,
  onRename,
  onRemove,
  onRefresh,
}: {
  row: CalendarRow;
  color: string;
  busy: boolean;
  onColor: (color: string) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="px-3 pb-3">
      <label className="mb-1 block text-xs font-medium text-ink-soft" htmlFor={`name-${row.id}`}>
        Name
      </label>
      <input
        id={`name-${row.id}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name.trim() && name.trim() !== row.name) onRename(name);
        }}
        className="mb-3 h-11 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink"
      />
      <p className="mb-1 text-xs font-medium text-ink-soft">Color</p>
      <div className="mb-2 flex flex-wrap">
        {CAL_COLORS.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            aria-label={swatch.label}
            aria-pressed={color === swatch.hex}
            onClick={() => onColor(swatch.hex)}
            className="inline-flex size-11 items-center justify-center"
          >
            <span
              className={`size-5 rounded-full ${color === swatch.hex ? "ring-2 ring-ink ring-offset-2 ring-offset-paper" : ""}`}
              style={{ backgroundColor: swatch.hex }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        {row.kind === "feed" && (
          <button
            type="button"
            disabled={busy}
            onClick={onRefresh}
            className="inline-flex h-11 items-center gap-2 rounded-lg px-2 text-sm text-ink hover:bg-paper-2 disabled:opacity-60"
          >
            <RefreshCw className="size-4" />
            {busy ? "Refreshing" : "Refresh"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            onRemove();
          }}
          className="inline-flex h-11 items-center gap-2 rounded-lg px-2 text-sm text-accent"
        >
          <Trash2 className="size-4" />
          {confirming ? "Confirm remove" : "Remove"}
        </button>
      </div>
    </div>
  );
}
