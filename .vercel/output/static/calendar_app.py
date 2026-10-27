#!/usr/bin/env python3
"""Meridian calendar — desktop companion.

Python 3.9+ and tkinter (both in the standard library). No pip installs.

Data files (created if missing):
  ~/Documents/appfiles/Python Generated Files/cal/cals.json
  ~/Documents/appfiles/Python Generated Files/cal/pref.json
  ~/Documents/appfiles/Python Generated Files/cal/app-cals.json

Run:  python3 calendar_app.py
Check the iCal parser without opening a window:  python3 calendar_app.py --check
"""

from __future__ import annotations

import calendar
import json
import re
import sys
import threading
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

COLORS = [
    ("#9c4221", "Terracotta"),
    ("#245c42", "Forest"),
    ("#243f66", "Harbor"),
    ("#8a6412", "Ochre"),
    ("#5e3450", "Plum"),
    ("#1f5c5c", "Tide"),
]
WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
ICAL_WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
LIGHT = {
    "bg": "#f3efe6",
    "card": "#faf7f1",
    "ink": "#1c1915",
    "muted": "#5c564c",
    "line": "#d9d1c3",
    "accent": "#9c4221",
    "accent_fg": "#fff8f3",
    "soft": "#e7e1d4",
}
DARK = {
    "bg": "#141311",
    "card": "#1c1a17",
    "ink": "#f3efe6",
    "muted": "#b7afa3",
    "line": "#34302a",
    "accent": "#e08a5d",
    "accent_fg": "#1c1915",
    "soft": "#26231f",
}


def data_dir() -> Path:
    folder = Path.home() / "Documents" / "appfiles" / "Python Generated Files" / "cal"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def local_tz():
    return datetime.now().astimezone().tzinfo or timezone.utc


def text_on(hex_color: str) -> str:
    raw = hex_color.removeprefix("#")
    if len(raw) != 6:
        return "#fff8f3"
    number = int(raw, 16)
    red, green, blue = (number >> 16) & 255, (number >> 8) & 255, number & 255
    luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
    return "#1c1915" if luminance > 0.62 else "#fff8f3"


def new_id() -> str:
    return str(uuid.uuid4())


def read_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def week_start(day: date) -> date:
    return day - timedelta(days=(day.weekday() + 1) % 7)


def add_months(day: date, months: int) -> date:
    index = day.month - 1 + months
    year = day.year + index // 12
    month = index % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def parse_duration(value: str) -> timedelta:
    match = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", value.strip())
    if not match:
        return timedelta(hours=1)
    days, hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return timedelta(days=days, hours=hours, minutes=minutes, seconds=seconds)


def parse_when(value: str, params: dict[str, str]):
    raw = value.strip()
    date_only = params.get("VALUE", "").upper() == "DATE" or ("T" not in raw and len(raw) >= 8)
    if date_only:
        return datetime.strptime(raw[:8], "%Y%m%d").date()
    stamp = datetime.strptime(raw[:15], "%Y%m%dT%H%M%S")
    if raw.endswith("Z"):
        return stamp.replace(tzinfo=timezone.utc)
    tzid = params.get("TZID")
    if tzid:
        try:
            return stamp.replace(tzinfo=ZoneInfo(tzid))
        except ZoneInfoNotFoundError:
            pass
    return stamp.replace(tzinfo=local_tz())


def unfold_ics(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    return re.sub(r"\n[ \t]", "", text)


def split_property(line: str):
    if ":" not in line:
        return None
    left, value = line.split(":", 1)
    parts = left.split(";")
    params: dict[str, str] = {}
    for part in parts[1:]:
        if "=" in part:
            key, raw = part.split("=", 1)
            params[key.upper()] = raw.strip().strip('"')
    return parts[0].upper(), params, value


def parse_rrule(value: str) -> dict[str, str]:
    rule: dict[str, str] = {}
    for part in value.split(";"):
        if "=" in part:
            key, raw = part.split("=", 1)
            rule[key.upper()] = raw
    return rule


@dataclass
class SourceEvent:
    uid: str
    title: str
    start: date | datetime
    end: date | datetime
    all_day: bool
    location: str = ""
    notes: str = ""
    rrule: dict[str, str] | None = None
    exdates: list = field(default_factory=list)
    recurrence_id: date | datetime | None = None


@dataclass
class Occurrence:
    key: str
    calendar_id: str
    event_id: str
    title: str
    start: date | datetime
    end: date | datetime
    all_day: bool
    location: str
    notes: str
    read_only: bool


def parse_ics(text: str) -> tuple[str, list[SourceEvent]]:
    name = ""
    events: list[SourceEvent] = []
    current: dict | None = None
    for line in unfold_ics(text).split("\n"):
        if line == "BEGIN:VEVENT":
            current = {
                "uid": "",
                "title": "",
                "start": None,
                "end": None,
                "all_day": False,
                "location": "",
                "notes": "",
                "rrule": None,
                "exdates": [],
                "recurrence_id": None,
                "duration": None,
            }
            continue
        if line == "END:VEVENT":
            if current and current["start"] is not None:
                start = current["start"]
                end = current["end"]
                if end is None:
                    if current["duration"] is not None and isinstance(start, datetime):
                        end = start + current["duration"]
                    elif current["all_day"] and isinstance(start, date):
                        end = start + timedelta(days=1)
                    elif isinstance(start, datetime):
                        end = start + timedelta(hours=1)
                    else:
                        end = start + timedelta(days=1)
                events.append(
                    SourceEvent(
                        uid=current["uid"] or new_id(),
                        title=unescape_ics(current["title"]) or "(No title)",
                        start=start,
                        end=end,
                        all_day=current["all_day"],
                        location=unescape_ics(current["location"]),
                        notes=unescape_ics(current["notes"]),
                        rrule=current["rrule"],
                        exdates=current["exdates"],
                        recurrence_id=current["recurrence_id"],
                    )
                )
            current = None
            continue
        prop = split_property(line)
        if prop is None:
            continue
        key, params, value = prop
        if current is None:
            if key == "X-WR-CALNAME":
                name = unescape_ics(value).strip()
            continue
        if key == "UID":
            current["uid"] = value.strip()
        elif key == "SUMMARY":
            current["title"] = value
        elif key == "DESCRIPTION":
            current["notes"] = value
        elif key == "LOCATION":
            current["location"] = value
        elif key == "RRULE":
            current["rrule"] = parse_rrule(value)
        elif key == "DURATION":
            current["duration"] = parse_duration(value)
        elif key in {"DTSTART", "DTEND", "EXDATE", "RECURRENCE-ID"}:
            pieces = [parse_when(part, params) for part in value.split(",") if part.strip()]
            if key == "DTSTART" and pieces:
                current["start"] = pieces[0]
                current["all_day"] = isinstance(pieces[0], date) and not isinstance(pieces[0], datetime)
            elif key == "DTEND" and pieces:
                current["end"] = pieces[0]
            elif key == "RECURRENCE-ID" and pieces:
                current["recurrence_id"] = pieces[0]
            elif key == "EXDATE":
                current["exdates"].extend(pieces)
    masters: dict[str, SourceEvent] = {}
    exceptions: list[SourceEvent] = []
    ordered: list[SourceEvent] = []
    for event in events:
        if event.recurrence_id is not None:
            exceptions.append(event)
        else:
            masters[event.uid] = event
            ordered.append(event)
    for event in exceptions:
        master = masters.get(event.uid)
        if master is not None and event.recurrence_id is not None:
            master.exdates.append(event.recurrence_id)
        event.rrule = None
        ordered.append(event)
    return name, ordered


def unescape_ics(value: str) -> str:
    return (
        value.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
    )


def _stamp(value: date | datetime) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=local_tz())
        return value
    return datetime(value.year, value.month, value.day, tzinfo=local_tz())


def _same_exclusion(candidate: date | datetime, excluded: date | datetime) -> bool:
    if isinstance(candidate, datetime) and isinstance(excluded, datetime):
        return abs((_stamp(candidate) - _stamp(excluded)).total_seconds()) < 2
    return _stamp(candidate).date() == _stamp(excluded).date()


def _after(left: date | datetime, right: date | datetime) -> bool:
    return _stamp(left) > _stamp(right)


def _shift_end(origin_start, origin_end, new_start):
    if isinstance(origin_start, datetime) and isinstance(new_start, datetime):
        return new_start + (origin_end - origin_start)
    if isinstance(origin_start, date) and isinstance(new_start, date) and not isinstance(new_start, datetime):
        return new_start + (origin_end - origin_start)
    return new_start


def _advance(current, freq: str, interval: int):
    if freq == "DAILY":
        return current + timedelta(days=interval)
    if freq == "WEEKLY":
        return current + timedelta(weeks=interval)
    if freq == "HOURLY" and isinstance(current, datetime):
        return current + timedelta(hours=interval)
    months = interval * (12 if freq == "YEARLY" else 1)
    if isinstance(current, datetime):
        moved = add_months(current.date(), months)
        return current.replace(year=moved.year, month=moved.month, day=moved.day)
    return add_months(current, months)


def _weekly_candidates(start, byday: list[str], interval: int, window_start: date, window_end: date, from_origin: bool):
    names = sorted({ICAL_WEEKDAYS[token[-2:]] for token in byday if token[-2:] in ICAL_WEEKDAYS})
    if not names:
        return
    origin = start.date() if isinstance(start, datetime) else start
    first_monday = origin - timedelta(days=origin.weekday())
    anchor = origin if from_origin else window_start
    anchor_monday = anchor - timedelta(days=anchor.weekday())
    delta_weeks = max(0, (anchor_monday - first_monday).days // 7)
    week_index = delta_weeks - (delta_weeks % interval)
    week_index = max(0, week_index - interval)
    last_week = week_index + interval * (520 if from_origin else 70)
    while week_index <= last_week:
        stop = False
        for weekday in names:
            day = first_monday + timedelta(days=week_index * 7 + weekday)
            if isinstance(start, datetime):
                candidate = start.replace(year=day.year, month=day.month, day=day.day)
            else:
                candidate = day
            if _after(candidate, window_end + timedelta(days=7)):
                stop = True
                break
            if not _after(start, candidate):
                yield candidate
        if stop:
            break
        week_index += interval


def expand_event(event: SourceEvent, window_start: date, window_end: date) -> Iterable[tuple]:
    window_start_dt = datetime(window_start.year, window_start.month, window_start.day, tzinfo=local_tz())
    window_end_dt = datetime(window_end.year, window_end.month, window_end.day, tzinfo=local_tz())
    rule = event.rrule or {}
    freq = rule.get("FREQ", "")
    if event.recurrence_id is not None or not freq:
        yield event.start, event.end
        return
    interval = max(1, int(rule.get("INTERVAL", "1") or 1))
    count = int(rule["COUNT"]) if rule.get("COUNT") else None
    until = parse_when(rule["UNTIL"], {"VALUE": "DATE"} if "T" not in rule.get("UNTIL", "") else {}) if rule.get("UNTIL") else None
    byday = rule["BYDAY"].split(",") if rule.get("BYDAY") and freq == "WEEKLY" else None
    produced = 0

    def accept(start):
        nonlocal produced
        if count is not None and produced >= count:
            return False
        if until is not None and _after(start, until):
            return False
        produced += 1
        if any(_same_exclusion(start, item) for item in event.exdates):
            return True
        end = _shift_end(event.start, event.end, start)
        if _overlaps(start, end, window_start, window_end, window_start_dt, window_end_dt):
            accepted.append((start, end))
        return True

    accepted: list[tuple] = []
    if byday:
        for candidate in _weekly_candidates(event.start, byday, interval, window_start, window_end, count is not None):
            if not accept(candidate):
                break
            if _after(candidate, window_end):
                break
        yield from accepted
        return

    cursor = event.start
    if count is None:
        origin = cursor.date() if isinstance(cursor, datetime) else cursor
        if origin < window_start:
            if freq == "DAILY":
                steps = max(0, (window_start - origin).days // interval - 1)
                cursor = cursor + timedelta(days=steps * interval)
            elif freq == "WEEKLY":
                steps = max(0, ((window_start - origin).days // 7) // interval - 1)
                cursor = cursor + timedelta(weeks=steps * interval)
            elif freq in {"MONTHLY", "YEARLY"}:
                months = (window_start.year - origin.year) * 12 + window_start.month - origin.month
                step = interval * (12 if freq == "YEARLY" else 1)
                jumps = max(0, months // step - 1)
                if jumps:
                    cursor = _advance(cursor, freq, jumps * interval)
    guard = 0
    while guard < 8000:
        guard += 1
        if not accept(cursor):
            break
        if _after(cursor, window_end) and count is None:
            break
        cursor = _advance(cursor, freq, interval)
    yield from accepted


def _overlaps(start, end, window_start, window_end, window_start_dt, window_end_dt) -> bool:
    if isinstance(start, datetime):
        return _stamp(start) < window_end_dt and _stamp(end) > window_start_dt
    return start < window_end and end > window_start


def occurrence_on_day(item: Occurrence, day: date) -> bool:
    if item.all_day and isinstance(item.start, date) and isinstance(item.end, date):
        return item.start <= day < item.end
    if isinstance(item.start, datetime) and isinstance(item.end, datetime):
        begin = datetime(day.year, day.month, day.day, tzinfo=local_tz())
        finish = begin + timedelta(days=1)
        return _stamp(item.start) < finish and _stamp(item.end) > begin
    return False


def app_event_to_occurrence(calendar_id: str, event: dict) -> Occurrence | None:
    try:
        if event.get("allDay"):
            start = datetime.strptime(event["start"], "%Y-%m-%d").date()
            end = datetime.strptime(event["end"], "%Y-%m-%d").date()
        else:
            start = datetime.fromisoformat(event["start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(event["end"].replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return None
    return Occurrence(
        key=f"{calendar_id}:{event.get('id', '')}",
        calendar_id=calendar_id,
        event_id=str(event.get("id", "")),
        title=str(event.get("title") or "(No title)"),
        start=start,
        end=end,
        all_day=bool(event.get("allDay")),
        location=str(event.get("location") or ""),
        notes=str(event.get("notes") or ""),
        read_only=False,
    )


def collect_occurrences(imported: list[dict], app_cals: list[dict], prefs: dict, window_start: date, window_end: date) -> list[Occurrence]:
    enabled = prefs.get("enabled", {})
    found: list[Occurrence] = []
    for calendar in imported:
        if enabled.get(calendar.get("id"), True) is False:
            continue
        ics = calendar.get("ics") or ""
        path = calendar.get("path") or ""
        if calendar.get("type") == "file" and path:
            file_path = Path(path).expanduser()
            if file_path.is_file():
                try:
                    ics = file_path.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    pass
        try:
            _, events = parse_ics(ics)
        except (ValueError, IndexError):
            continue
        for event in events:
            try:
                spans = list(expand_event(event, window_start, window_end))
            except (ValueError, OverflowError):
                continue
            for index, (start, end) in enumerate(spans):
                if not _overlaps(
                    start,
                    end,
                    window_start,
                    window_end,
                    datetime(window_start.year, window_start.month, window_start.day, tzinfo=local_tz()),
                    datetime(window_end.year, window_end.month, window_end.day, tzinfo=local_tz()),
                ):
                    continue
                all_day = isinstance(start, date) and not isinstance(start, datetime)
                found.append(
                    Occurrence(
                        key=f"{calendar.get('id')}:{event.uid}:{index}:{start}",
                        calendar_id=str(calendar.get("id")),
                        event_id=event.uid,
                        title=event.title,
                        start=start,
                        end=end,
                        all_day=all_day,
                        location=event.location,
                        notes=event.notes,
                        read_only=True,
                    )
                )
    for calendar in app_cals:
        if enabled.get(calendar.get("id"), True) is False:
            continue
        for event in calendar.get("events", []):
            occurrence = app_event_to_occurrence(str(calendar.get("id")), event)
            if occurrence is None:
                continue
            if occurrence_on_day(occurrence, window_start) or _event_overlaps_window(occurrence, window_start, window_end):
                found.append(occurrence)
    return found


def _event_overlaps_window(item: Occurrence, window_start: date, window_end: date) -> bool:
    return _overlaps(
        item.start,
        item.end,
        window_start,
        window_end,
        datetime(window_start.year, window_start.month, window_start.day, tzinfo=local_tz()),
        datetime(window_end.year, window_end.month, window_end.day, tzinfo=local_tz()),
    )


def fetch_feed(url: str) -> tuple[str, str]:
    raw = url.strip()
    lower = raw.lower()
    if lower.startswith("webcals://"):
        raw = "https://" + raw[len("webcals://") :]
    elif lower.startswith("webcal://"):
        raw = "https://" + raw[len("webcal://") :]
    if not raw.lower().startswith(("https://", "http://")):
        raise RuntimeError("Feed links must start with https:// or webcal://.")
    request = urllib.request.Request(
        raw,
        headers={"User-Agent": "MeridianCalendar/1.0", "Accept": "text/calendar, text/plain, */*"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = response.read(4_000_001)
    if len(payload) > 4_000_000:
        raise RuntimeError("That feed is too large.")
    text = payload.decode("utf-8", errors="replace")
    if "BEGIN:VCALENDAR" not in text.upper():
        raise RuntimeError("That link did not return an iCalendar feed.")
    return text, raw


def default_prefs() -> dict:
    return {"theme": "light", "view": "month", "colors": {}, "enabled": {}, "initialized": False}


def seed_state() -> tuple[list, list, dict]:
    today = date.today()
    calendar_id = "studio"

    def timed(offset: int, hour: int, minute: int, hours: int = 1, minutes: int = 0) -> tuple[str, str]:
        start = datetime.combine(today + timedelta(days=offset), datetime.min.time()).replace(
            hour=hour, minute=minute, tzinfo=local_tz()
        )
        end = start + timedelta(hours=hours, minutes=minutes)
        return start.isoformat(), end.isoformat()

    start_review, end_review = timed(0, 14, 0, 1, 30)
    start_pages, end_pages = timed(0, 9, 30, 0, 45)
    start_gallery, end_gallery = timed(-1, 16, 0, 1, 30)
    start_paper, end_paper = timed(2, 11, 0, 0, 30)
    start_dinner, end_dinner = timed(4, 18, 30, 2, 0)
    prefs = default_prefs()
    prefs.update({"initialized": True, "colors": {calendar_id: COLORS[0][0]}, "enabled": {calendar_id: True}})
    app_cals = [
        {
            "id": calendar_id,
            "name": "Studio",
            "events": [
                {"id": "morning-pages", "title": "Morning pages", "start": start_pages, "end": end_pages, "allDay": False, "location": "Desk", "notes": "Three pages before the day starts."},
                {"id": "client-review", "title": "Client review", "start": start_review, "end": end_review, "allDay": False, "location": "North studio", "notes": "Bring the paper samples."},
                {"id": "press-check", "title": "Press check", "start": (today + timedelta(days=1)).isoformat(), "end": (today + timedelta(days=2)).isoformat(), "allDay": True, "location": "Riverside print", "notes": ""},
                {"id": "gallery-walk", "title": "Gallery walk", "start": start_gallery, "end": end_gallery, "allDay": False, "location": "", "notes": ""},
                {"id": "paper-order", "title": "Paper order", "start": start_paper, "end": end_paper, "allDay": False, "location": "", "notes": "Cotton 118gsm, warm white."},
                {"id": "dinner", "title": "Dinner with Ana", "start": start_dinner, "end": end_dinner, "allDay": False, "location": "Lumen", "notes": ""},
            ],
        }
    ]
    return [], app_cals, prefs


def load_state() -> tuple[list, list, dict]:
    folder = data_dir()
    prefs = read_json(folder / "pref.json", None)
    if not isinstance(prefs, dict) or not prefs.get("initialized"):
        imported, app_cals, prefs = seed_state()
        save_state(imported, app_cals, prefs)
        return imported, app_cals, prefs
    cals = read_json(folder / "cals.json", {"calendars": []})
    app_file = read_json(folder / "app-cals.json", {"calendars": []})
    imported = cals.get("calendars", []) if isinstance(cals, dict) else []
    app_cals = app_file.get("calendars", []) if isinstance(app_file, dict) else []
    prefs.setdefault("theme", "light")
    prefs.setdefault("view", "month")
    prefs.setdefault("colors", {})
    prefs.setdefault("enabled", {})
    return imported, app_cals, prefs


def save_state(imported: list, app_cals: list, prefs: dict) -> None:
    folder = data_dir()
    write_json(folder / "cals.json", {"calendars": imported})
    write_json(folder / "app-cals.json", {"calendars": app_cals})
    write_json(folder / "pref.json", prefs)


def visible_window(view: str, anchor: date) -> tuple[date, date, list[date]]:
    if view == "month":
        start = week_start(anchor.replace(day=1))
        days = [start + timedelta(days=index) for index in range(42)]
    elif view == "week":
        start = week_start(anchor)
        days = [start + timedelta(days=index) for index in range(7)]
    else:
        days = [anchor]
    return days[0], days[-1] + timedelta(days=1), days


def _self_check() -> None:
    ics = """BEGIN:VCALENDAR
X-WR-CALNAME:Press
BEGIN:VEVENT
UID:weekly@quire
SUMMARY:Weekly stand
DTSTART:20261005T150000Z
DTEND:20261005T153000Z
RRULE:FREQ=WEEKLY;COUNT=3
EXDATE:20261012T150000Z
END:VEVENT
BEGIN:VEVENT
UID:allday@quire
SUMMARY:Fair\\, day
DTSTART;VALUE=DATE:20261026
DTEND;VALUE=DATE:20261028
END:VEVENT
BEGIN:VEVENT
UID:zoned@quire
SUMMARY:Zoned
DTSTART;TZID=America/New_York:20261026T090000
DTEND;TZID=America/New_York:20261026T100000
END:VEVENT
END:VCALENDAR
"""
    name, events = parse_ics(ics)
    assert name == "Press", name
    assert len(events) == 3, len(events)
    weekly = events[0]
    spans = list(expand_event(weekly, date(2026, 10, 1), date(2026, 11, 1)))
    assert len(spans) == 2, spans
    allday = next(event for event in events if event.uid == "allday@quire")
    assert allday.title == "Fair, day"
    assert allday.all_day and allday.end == date(2026, 10, 28)
    zoned = next(event for event in events if event.uid == "zoned@quire")
    assert isinstance(zoned.start, datetime) and zoned.start.hour == 9
    print("calendar parser ok")


def main() -> None:
    import tkinter as tk
    from tkinter import filedialog, messagebox, simpledialog, ttk

    class Meridian(tk.Tk):
        def __init__(self) -> None:
            super().__init__()
            self.title("Meridian")
            self.geometry("1180x760")
            self.minsize(860, 560)
            self.imported, self.app_cals, self.prefs = load_state()
            self.anchor = date.today()
            self.hits: list[tuple[float, float, float, float, Callable[[], None]]] = []
            self.palette = DARK if self.prefs.get("theme") == "dark" else LIGHT
            self._build()
            self.apply_theme()
            self.after(200, self.refresh_feeds_async)
            self.protocol("WM_DELETE_WINDOW", self.destroy)

        def _build(self) -> None:
            self.side = tk.Frame(self, width=280)
            self.side.pack(side="left", fill="y")
            self.side.pack_propagate(False)
            self.main = tk.Frame(self)
            self.main.pack(side="left", fill="both", expand=True)
            self.heading = tk.Label(self.main, text="Meridian", anchor="w")
            self.heading.pack(fill="x", padx=16, pady=(12, 0))
            bar = tk.Frame(self.main)
            bar.pack(fill="x", padx=12, pady=8)
            self.prev_btn = tk.Button(bar, text="‹", width=3, command=lambda: self.shift(-1))
            self.today_btn = tk.Button(bar, text="Today", command=self.go_today)
            self.next_btn = tk.Button(bar, text="›", width=3, command=lambda: self.shift(1))
            self.prev_btn.pack(side="left")
            self.today_btn.pack(side="left", padx=4)
            self.next_btn.pack(side="left")
            self.period = tk.Label(bar, text="", anchor="w")
            self.period.pack(side="left", padx=12)
            self.view_buttons = {}
            for view in ("day", "week", "month"):
                button = tk.Button(bar, text=view.capitalize(), command=lambda value=view: self.set_view(value))
                button.pack(side="right", padx=2)
                self.view_buttons[view] = button
            self.new_btn = tk.Button(bar, text="New event", command=self.new_event)
            self.new_btn.pack(side="right", padx=8)
            self.canvas = tk.Canvas(self.main, highlightthickness=0, bd=0)
            self.scroll = ttk.Scrollbar(self.main, orient="vertical", command=self.canvas.yview)
            self.canvas.configure(yscrollcommand=self.scroll.set)
            self.scroll.pack(side="right", fill="y")
            self.canvas.pack(side="left", fill="both", expand=True, padx=(8, 0), pady=(0, 8))
            self.canvas.bind("<Configure>", lambda _event: self.redraw())
            self.canvas.bind("<Button-1>", self.on_click)
            self.canvas.bind("<MouseWheel>", self.on_wheel)
            self.canvas.bind("<Button-4>", self.on_wheel)
            self.canvas.bind("<Button-5>", self.on_wheel)
            self.cal_box = tk.Frame(self.side)
            self.cal_box.pack(fill="both", expand=True, padx=8, pady=8)
            actions = tk.Frame(self.side)
            actions.pack(fill="x", padx=8, pady=(0, 8))
            self.file_btn = tk.Button(actions, text="Add ICS file", command=self.add_file)
            self.url_btn = tk.Button(actions, text="Add feed link", command=self.add_feed)
            self.blank_btn = tk.Button(actions, text="New calendar", command=self.add_blank)
            self.refresh_btn = tk.Button(actions, text="Refresh feeds", command=self.refresh_feeds_async)
            self.theme_btn = tk.Button(actions, text="Theme", command=self.toggle_theme)
            for button in (self.file_btn, self.url_btn, self.blank_btn, self.refresh_btn, self.theme_btn):
                button.pack(fill="x", pady=2)
            self.status = tk.Label(self.side, text="", wraplength=250, justify="left")
            self.status.pack(fill="x", padx=10, pady=(0, 10))
            self.render_calendars()
            self.update_period()

        def apply_theme(self) -> None:
            palette = self.palette
            self.configure(bg=palette["bg"])
            for widget in (
                self.side,
                self.main,
                self.heading,
                self.period,
                self.status,
                self.cal_box,
            ):
                widget.configure(bg=palette["bg"])
            self.heading.configure(fg=palette["ink"], font=("Georgia", 22))
            self.period.configure(fg=palette["ink"], font=("Georgia", 16))
            self.status.configure(fg=palette["muted"], bg=palette["bg"])
            self.canvas.configure(bg=palette["bg"])
            for button in (
                self.prev_btn,
                self.today_btn,
                self.next_btn,
                self.new_btn,
                self.file_btn,
                self.url_btn,
                self.blank_btn,
                self.refresh_btn,
                self.theme_btn,
                *self.view_buttons.values(),
            ):
                active = button in self.view_buttons.values() and self.prefs.get("view") == button.cget("text").lower()
                button.configure(
                    bg=palette["accent"] if active or button is self.new_btn else palette["card"],
                    fg=palette["accent_fg"] if active or button is self.new_btn else palette["ink"],
                    activebackground=palette["soft"],
                    activeforeground=palette["ink"],
                    relief="flat",
                    bd=0,
                    highlightthickness=0,
                    padx=8,
                    pady=6,
                )
            self.theme_btn.configure(text="Light mode" if self.prefs.get("theme") == "dark" else "Dark mode")
            self.render_calendars()
            self.redraw()

        def render_calendars(self) -> None:
            for child in self.cal_box.winfo_children():
                child.destroy()
            palette = self.palette
            tk.Label(self.cal_box, text="CALENDARS", bg=palette["bg"], fg=palette["muted"]).pack(anchor="w", pady=(4, 6))
            rows = [(calendar, "app") for calendar in self.app_cals] + [(calendar, calendar.get("type", "file")) for calendar in self.imported]
            if not rows:
                tk.Label(self.cal_box, text="No calendars yet.", bg=palette["bg"], fg=palette["muted"]).pack(anchor="w")
            for calendar, kind in rows:
                cal_id = calendar["id"]
                row = tk.Frame(self.cal_box, bg=palette["bg"])
                row.pack(fill="x", pady=2)
                enabled = tk.BooleanVar(value=self.prefs.get("enabled", {}).get(cal_id, True) is not False)
                check = tk.Checkbutton(
                    row,
                    variable=enabled,
                    bg=palette["bg"],
                    activebackground=palette["bg"],
                    command=lambda value=enabled, ident=cal_id: self.set_enabled(ident, bool(value.get())),
                )
                check.pack(side="left")
                color = self.prefs.get("colors", {}).get(cal_id, COLORS[0][0])
                swatch = tk.Button(row, text="", width=2, bg=color, command=lambda ident=cal_id, widget=None: None)
                swatch.configure(command=lambda ident=cal_id, widget=swatch: self.pick_color(ident, widget))
                swatch.pack(side="left", padx=4)
                label = tk.Label(row, text=calendar.get("name", "Calendar"), bg=palette["bg"], fg=palette["ink"], anchor="w")
                label.pack(side="left", fill="x", expand=True)
                label.bind("<Double-Button-1>", lambda _event, ident=cal_id, current=calendar.get("name", ""): self.rename(ident, current))
                tk.Button(
                    row,
                    text="×",
                    command=lambda ident=cal_id, title=calendar.get("name", "calendar"): self.remove_calendar(ident, title),
                    bg=palette["bg"],
                    fg=palette["muted"],
                    relief="flat",
                    bd=0,
                ).pack(side="right")
                detail = "Created here" if kind == "app" else ("Feed" if kind == "feed" else "File")
                tk.Label(self.cal_box, text=detail, bg=palette["bg"], fg=palette["muted"]).pack(anchor="w")

        def set_status(self, text: str) -> None:
            self.status.configure(text=text)

        def persist(self) -> None:
            self.prefs["initialized"] = True
            save_state(self.imported, self.app_cals, self.prefs)

        def set_enabled(self, cal_id: str, enabled: bool) -> None:
            self.prefs.setdefault("enabled", {})[cal_id] = enabled
            self.persist()
            self.redraw()

        def pick_color(self, cal_id: str, widget) -> None:
            import tkinter as tk

            menu = tk.Menu(self, tearoff=0)
            for hex_color, label in COLORS:
                menu.add_command(label=label, command=lambda value=hex_color: self.set_color(cal_id, value))
            menu.tk_popup(widget.winfo_rootx(), widget.winfo_rooty() + widget.winfo_height())

        def set_color(self, cal_id: str, color: str) -> None:
            self.prefs.setdefault("colors", {})[cal_id] = color
            self.persist()
            self.render_calendars()
            self.redraw()

        def rename(self, cal_id: str, current: str) -> None:
            from tkinter import simpledialog

            name = simpledialog.askstring("Rename calendar", "Name", initialvalue=current, parent=self)
            if not name or not name.strip():
                return
            for collection in (self.imported, self.app_cals):
                for calendar in collection:
                    if calendar.get("id") == cal_id:
                        calendar["name"] = name.strip()
            self.persist()
            self.render_calendars()

        def remove_calendar(self, cal_id: str, title: str) -> None:
            from tkinter import messagebox

            if not messagebox.askyesno("Remove calendar", f"Remove {title}?", parent=self):
                return
            self.imported = [calendar for calendar in self.imported if calendar.get("id") != cal_id]
            self.app_cals = [calendar for calendar in self.app_cals if calendar.get("id") != cal_id]
            self.prefs.get("colors", {}).pop(cal_id, None)
            self.prefs.get("enabled", {}).pop(cal_id, None)
            self.persist()
            self.render_calendars()
            self.redraw()

        def next_color(self) -> str:
            used = set(self.prefs.get("colors", {}).values())
            for hex_color, _label in COLORS:
                if hex_color not in used:
                    return hex_color
            return COLORS[0][0]

        def remember(self, cal_id: str) -> None:
            self.prefs.setdefault("colors", {})[cal_id] = self.next_color()
            self.prefs.setdefault("enabled", {})[cal_id] = True

        def add_blank(self) -> None:
            from tkinter import simpledialog

            name = simpledialog.askstring("New calendar", "Calendar name", parent=self)
            if not name or not name.strip():
                return
            cal_id = new_id()
            self.app_cals.append({"id": cal_id, "name": name.strip(), "events": []})
            self.remember(cal_id)
            self.persist()
            self.render_calendars()
            self.set_status(f"Created {name.strip()}.")

        def add_file(self) -> None:
            from tkinter import filedialog

            path = filedialog.askopenfilename(parent=self, filetypes=[("iCalendar", "*.ics *.ical"), ("All files", "*.*")])
            if not path:
                return
            try:
                text = Path(path).read_text(encoding="utf-8", errors="replace")
                feed_name, events = parse_ics(text)
            except (OSError, ValueError) as error:
                self.set_status(str(error) or "Could not read that file.")
                return
            if "BEGIN:VCALENDAR" not in text.upper():
                self.set_status("That file is not an iCalendar file.")
                return
            cal_id = new_id()
            self.imported.append(
                {
                    "id": cal_id,
                    "name": feed_name or Path(path).stem,
                    "type": "file",
                    "path": path,
                    "url": "",
                    "ics": text,
                    "fetchedAt": datetime.now(timezone.utc).isoformat(),
                }
            )
            self.remember(cal_id)
            self.persist()
            self.render_calendars()
            self.redraw()
            self.set_status(f"Added {feed_name or Path(path).name} · {len(events)} events.")

        def add_feed(self) -> None:
            from tkinter import simpledialog

            url = simpledialog.askstring("Calendar feed", "Paste a Google or Apple iCal link", parent=self)
            if not url or not url.strip():
                return
            self.set_status("Fetching feed…")

            def work() -> None:
                try:
                    text, normalized = fetch_feed(url)
                    feed_name, _events = parse_ics(text)
                except Exception as error:
                    self.after(0, lambda: self.set_status(str(error)))
                    return

                def done() -> None:
                    existing = next((calendar for calendar in self.imported if calendar.get("type") == "feed" and calendar.get("url") == normalized), None)
                    if existing:
                        existing["ics"] = text
                        existing["fetchedAt"] = datetime.now(timezone.utc).isoformat()
                        self.set_status(f"Updated {existing.get('name')}.")
                    else:
                        cal_id = new_id()
                        self.imported.append(
                            {
                                "id": cal_id,
                                "name": feed_name or "Feed",
                                "type": "feed",
                                "path": "",
                                "url": normalized,
                                "ics": text,
                                "fetchedAt": datetime.now(timezone.utc).isoformat(),
                            }
                        )
                        self.remember(cal_id)
                        self.set_status(f"Subscribed to {feed_name or 'feed'}.")
                    self.persist()
                    self.render_calendars()
                    self.redraw()

                self.after(0, done)

            threading.Thread(target=work, daemon=True).start()

        def refresh_feeds_async(self) -> None:
            feeds = [calendar for calendar in self.imported if calendar.get("type") == "feed" and calendar.get("url")]
            if not feeds:
                return

            def work() -> None:
                errors = []
                for calendar in feeds:
                    try:
                        text, _url = fetch_feed(calendar["url"])
                        calendar["ics"] = text
                        calendar["fetchedAt"] = datetime.now(timezone.utc).isoformat()
                    except Exception as error:
                        errors.append(f"{calendar.get('name')}: {error}")

                def done() -> None:
                    self.persist()
                    self.redraw()
                    self.set_status("Feeds updated." if not errors else errors[0])

                self.after(0, done)

            threading.Thread(target=work, daemon=True).start()

        def toggle_theme(self) -> None:
            self.prefs["theme"] = "light" if self.prefs.get("theme") == "dark" else "dark"
            self.palette = DARK if self.prefs["theme"] == "dark" else LIGHT
            self.persist()
            self.apply_theme()

        def set_view(self, view: str) -> None:
            self.prefs["view"] = view
            self.persist()
            self.update_period()
            self.apply_theme()
            self.redraw(reset_scroll=view != "month")

        def go_today(self) -> None:
            self.anchor = date.today()
            self.update_period()
            self.redraw(reset_scroll=self.prefs.get("view") != "month")

        def shift(self, direction: int) -> None:
            view = self.prefs.get("view", "month")
            if view == "month":
                self.anchor = add_months(self.anchor.replace(day=1), direction)
            elif view == "week":
                self.anchor += timedelta(days=7 * direction)
            else:
                self.anchor += timedelta(days=direction)
            self.update_period()
            self.redraw(reset_scroll=view != "month")

        def update_period(self) -> None:
            view = self.prefs.get("view", "month")
            if view == "month":
                label = self.anchor.strftime("%B %Y")
            elif view == "week":
                start = week_start(self.anchor)
                end = start + timedelta(days=6)
                label = f"{start.strftime('%b %-d') if sys.platform != 'win32' else start.strftime('%b %d').lstrip('0')} – {end.strftime('%b %d, %Y')}"
            else:
                label = self.anchor.strftime("%A, %B %-d") if sys.platform != "win32" else self.anchor.strftime("%A, %B %d").replace(" 0", " ")
            self.period.configure(text=label)

        def current_occurrences(self) -> tuple[list[date], list[Occurrence]]:
            view = self.prefs.get("view", "month")
            start, end, days = visible_window(view, self.anchor)
            return days, collect_occurrences(self.imported, self.app_cals, self.prefs, start, end)

        def redraw(self, reset_scroll: bool = False) -> None:
            if not self.canvas.winfo_exists():
                return
            self.canvas.delete("all")
            self.hits = []
            width = max(self.canvas.winfo_width(), 200)
            height = max(self.canvas.winfo_height(), 200)
            days, events = self.current_occurrences()
            if self.prefs.get("view") == "month":
                self.canvas.configure(scrollregion=(0, 0, width, height))
                self.draw_month(width, height, days, events)
            else:
                content_height = self.draw_time(width, days, events)
                self.canvas.configure(scrollregion=(0, 0, width, content_height))
                if reset_scroll:
                    self.canvas.yview_moveto(min(0.92, (7 * 48) / max(content_height, 1)))

        def draw_month(self, width: int, height: int, days: list[date], events: list[Occurrence]) -> None:
            palette = self.palette
            header = 28
            self.canvas.create_rectangle(0, 0, width, height, fill=palette["bg"], outline="")
            cell_w = width / 7
            cell_h = max((height - header) / 6, 20)
            for index, name in enumerate(WEEKDAY_NAMES):
                self.canvas.create_text(index * cell_w + 8, 8, text=name, anchor="nw", fill=palette["muted"], font=("TkDefaultFont", 9))
            today = date.today()
            for index, day in enumerate(days):
                column = index % 7
                row = index // 7
                x = column * cell_w
                y = header + row * cell_h
                outside = day.month != self.anchor.month
                selected = day == self.anchor
                fill = palette["soft"] if selected else palette["card"]
                self.canvas.create_rectangle(x, y, x + cell_w, y + cell_h, fill=fill, outline=palette["line"])
                number_fill = palette["accent_fg"] if day == today else (palette["muted"] if outside else palette["ink"])
                if day == today:
                    self.canvas.create_oval(x + 6, y + 6, x + 26, y + 26, fill=palette["accent"], outline="")
                self.canvas.create_text(x + 16, y + 16, text=str(day.day), fill=number_fill, font=("TkDefaultFont", 10, "bold" if day == today else "normal"))
                self.hits.append((x, y, x + 30, y + 30, lambda value=day: self.select_day(value)))
                day_events = [event for event in events if occurrence_on_day(event, day)]
                for event_index, event in enumerate(day_events[:3]):
                    color = self.prefs.get("colors", {}).get(event.calendar_id, COLORS[0][0])
                    top = y + 32 + event_index * 18
                    self.canvas.create_rectangle(x + 4, top, x + cell_w - 4, top + 16, fill=color, outline="")
                    prefix = "" if event.all_day or not isinstance(event.start, datetime) else event.start.astimezone().strftime("%-H:%M ") if sys.platform != "win32" else event.start.astimezone().strftime("%H:%M ")
                    self.canvas.create_text(x + 8, top + 8, text=(prefix + event.title)[:28], anchor="w", fill=text_on(color), font=("TkDefaultFont", 8))
                    self.hits.append((x + 4, top, x + cell_w - 4, top + 16, lambda item=event: self.open_occurrence(item)))
                if len(day_events) > 3:
                    self.canvas.create_text(x + 8, y + cell_h - 10, text=f"+{len(day_events) - 3} more", anchor="w", fill=palette["muted"], font=("TkDefaultFont", 8))

        def draw_time(self, width: int, days: list[date], events: list[Occurrence]) -> int:
            palette = self.palette
            gutter = 64
            header = 56
            hour_h = 48
            columns = max(len(days), 1)
            col_w = max((width - gutter) / columns, 40)
            self.canvas.create_rectangle(0, 0, width, header + hour_h * 24 + 40, fill=palette["bg"], outline="")
            for index, day in enumerate(days):
                x = gutter + index * col_w
                fill = palette["accent"] if day == date.today() else palette["ink"]
                self.canvas.create_text(x + 8, 10, text=WEEKDAY_NAMES[(day.weekday() + 1) % 7], anchor="nw", fill=palette["muted"])
                self.canvas.create_text(x + 8, 28, text=str(day.day), anchor="nw", fill=fill, font=("Georgia", 16))
                self.hits.append((x, 0, x + col_w, header, lambda value=day: self.select_day(value)))
                all_day = [event for event in events if event.all_day and occurrence_on_day(event, day)]
                for event_index, event in enumerate(all_day[:2]):
                    color = self.prefs.get("colors", {}).get(event.calendar_id, COLORS[0][0])
                    top = header + event_index * 18
                    self.canvas.create_rectangle(x + 4, top, x + col_w - 4, top + 16, fill=color, outline="")
                    self.canvas.create_text(x + 8, top + 8, text=event.title[:24], anchor="w", fill=text_on(color), font=("TkDefaultFont", 8))
                    self.hits.append((x + 4, top, x + col_w - 4, top + 16, lambda item=event: self.open_occurrence(item)))
            grid_top = header + 40
            for hour in range(24):
                y = grid_top + hour * hour_h
                self.canvas.create_line(gutter, y, gutter + columns * col_w, y, fill=palette["line"])
                if hour:
                    label = datetime(2000, 1, 1, hour).strftime("%I %p").lstrip("0")
                    self.canvas.create_text(gutter - 8, y, text=label, anchor="e", fill=palette["muted"], font=("TkDefaultFont", 8))
            for index, day in enumerate(days):
                x = gutter + index * col_w
                self.canvas.create_line(x, grid_top, x, grid_top + 24 * hour_h, fill=palette["line"])
                self.hits.append((x, grid_top, x + col_w, grid_top + 24 * hour_h, lambda value=day, left=x, top=grid_top: self.create_from_click(value, left, top)))
                timed = [event for event in events if not event.all_day and occurrence_on_day(event, day) and isinstance(event.start, datetime)]
                timed.sort(key=lambda event: _stamp(event.start))
                for event in timed:
                    start_local = event.start.astimezone()
                    end_local = event.end.astimezone() if isinstance(event.end, datetime) else start_local + timedelta(hours=1)
                    day_begin = datetime.combine(day, datetime.min.time()).astimezone()
                    day_end = day_begin + timedelta(days=1)
                    start_local = max(start_local, day_begin)
                    end_local = min(max(end_local, start_local + timedelta(minutes=30)), day_end)
                    start_minutes = (start_local - day_begin).total_seconds() / 60
                    end_minutes = (end_local - day_begin).total_seconds() / 60
                    top = grid_top + (start_minutes / 60) * hour_h
                    bottom = grid_top + (end_minutes / 60) * hour_h
                    color = self.prefs.get("colors", {}).get(event.calendar_id, COLORS[0][0])
                    self.canvas.create_rectangle(x + 4, top, x + col_w - 4, max(bottom, top + 18), fill=color, outline="")
                    self.canvas.create_text(x + 8, top + 10, text=event.title[:28], anchor="w", fill=text_on(color), font=("TkDefaultFont", 8))
                    self.hits.append((x + 4, top, x + col_w - 4, max(bottom, top + 18), lambda item=event: self.open_occurrence(item)))
            if self.anchor == date.today() or any(day == date.today() for day in days):
                now = datetime.now().astimezone()
                if any(day == now.date() for day in days):
                    minutes = now.hour * 60 + now.minute
                    y = grid_top + (minutes / 60) * hour_h
                    self.canvas.create_line(gutter, y, gutter + columns * col_w, y, fill=palette["accent"])
            return int(grid_top + 24 * hour_h + 24)

        def create_from_click(self, day: date, left: float, top: float) -> None:
            y = self.canvas.canvasy(self.canvas.winfo_pointery() - self.canvas.winfo_rooty())
            hour_h = 48
            grid_top = top
            minutes = max(0, min(23 * 60 + 30, int((y - grid_top) / hour_h * 60)))
            minutes = (minutes // 30) * 30
            self.anchor = day
            self.edit_event(None, datetime.combine(day, datetime.min.time()).replace(hour=minutes // 60, minute=minutes % 60))

        def select_day(self, day: date) -> None:
            self.anchor = day
            if self.prefs.get("view") == "month":
                self.update_period()
                self.redraw()
            else:
                self.prefs["view"] = "day"
                self.persist()
                self.update_period()
                self.apply_theme()

        def on_click(self, event) -> None:
            x = self.canvas.canvasx(event.x)
            y = self.canvas.canvasy(event.y)
            for x1, y1, x2, y2, action in reversed(self.hits):
                if x1 <= x <= x2 and y1 <= y <= y2:
                    action()
                    return

        def on_wheel(self, event) -> None:
            delta = -1 if getattr(event, "delta", 0) > 0 or getattr(event, "num", 0) == 4 else 1
            self.canvas.yview_scroll(delta, "units")

        def new_event(self) -> None:
            self.edit_event(None, datetime.combine(self.anchor, datetime.min.time()).replace(hour=9))

        def open_occurrence(self, occurrence: Occurrence) -> None:
            if occurrence.read_only:
                from tkinter import messagebox

                when = "All day" if occurrence.all_day else _stamp(occurrence.start).astimezone().strftime("%a %b %d, %I:%M %p").replace(" 0", " ")
                extra = f"\n{occurrence.location}" if occurrence.location else ""
                notes = f"\n\n{occurrence.notes}" if occurrence.notes else ""
                messagebox.showinfo(occurrence.title, f"{when}{extra}{notes}\n\nImported events are read-only.", parent=self)
                return
            self.edit_event(occurrence, None)

        def edit_event(self, occurrence: Occurrence | None, default_start: datetime | None) -> None:
            import tkinter as tk

            if not self.app_cals:
                cal_id = new_id()
                self.app_cals.append({"id": cal_id, "name": "My calendar", "events": []})
                self.remember(cal_id)
                self.persist()
                self.render_calendars()
            dialog = tk.Toplevel(self)
            dialog.title("Event")
            dialog.configure(bg=self.palette["bg"])
            dialog.transient(self)
            dialog.grab_set()
            existing = None
            calendar_id = self.app_cals[0]["id"]
            if occurrence is not None:
                calendar_id = occurrence.calendar_id
                for calendar in self.app_cals:
                    if calendar["id"] == calendar_id:
                        existing = next((event for event in calendar["events"] if event.get("id") == occurrence.event_id), None)
            start_value = default_start or datetime.now().replace(hour=9, minute=0, second=0, microsecond=0)
            end_value = start_value + timedelta(hours=1)
            all_day = False
            title_value = ""
            location_value = ""
            notes_value = ""
            end_day = self.anchor
            if existing:
                title_value = existing.get("title", "")
                location_value = existing.get("location", "")
                notes_value = existing.get("notes", "")
                all_day = bool(existing.get("allDay"))
                if all_day:
                    start_day = datetime.strptime(existing["start"], "%Y-%m-%d").date()
                    end_day = datetime.strptime(existing["end"], "%Y-%m-%d").date() - timedelta(days=1)
                    start_value = datetime.combine(start_day, datetime.min.time()).replace(hour=9)
                    end_value = start_value + timedelta(hours=1)
                else:
                    start_value = datetime.fromisoformat(existing["start"].replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
                    end_value = datetime.fromisoformat(existing["end"].replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
                    end_day = end_value.date()
            elif occurrence is not None and isinstance(occurrence.start, datetime):
                start_value = occurrence.start.astimezone().replace(tzinfo=None)
                end_value = occurrence.end.astimezone().replace(tzinfo=None) if isinstance(occurrence.end, datetime) else start_value + timedelta(hours=1)

            def labeled(row: int, caption: str):
                tk.Label(dialog, text=caption, bg=self.palette["bg"], fg=self.palette["ink"]).grid(row=row, column=0, sticky="w", padx=12, pady=4)
                entry = tk.Entry(dialog, width=32, bg=self.palette["card"], fg=self.palette["ink"], relief="flat")
                entry.grid(row=row, column=1, padx=12, pady=4)
                return entry

            title_entry = labeled(0, "Title")
            title_entry.insert(0, title_value)
            names = [calendar["name"] for calendar in self.app_cals]
            ids = [calendar["id"] for calendar in self.app_cals]
            tk.Label(dialog, text="Calendar", bg=self.palette["bg"], fg=self.palette["ink"]).grid(row=1, column=0, sticky="w", padx=12, pady=4)
            chosen = tk.StringVar(value=calendar_id)
            menu = tk.OptionMenu(dialog, chosen, *ids)
            menu.configure(bg=self.palette["card"], relief="flat")
            menu.grid(row=1, column=1, sticky="ew", padx=12, pady=4)
            all_day_var = tk.BooleanVar(value=all_day)
            tk.Checkbutton(dialog, text="All day", variable=all_day_var, bg=self.palette["bg"], fg=self.palette["ink"], activebackground=self.palette["bg"]).grid(row=2, column=1, sticky="w", padx=12)
            date_entry = labeled(3, "Date")
            date_entry.insert(0, start_value.date().isoformat())
            end_date_entry = labeled(4, "End date")
            end_date_entry.insert(0, end_day.isoformat())
            start_entry = labeled(5, "Starts")
            start_entry.insert(0, start_value.strftime("%H:%M"))
            end_entry = labeled(6, "Ends")
            end_entry.insert(0, end_value.strftime("%H:%M"))
            location_entry = labeled(7, "Location")
            location_entry.insert(0, location_value)
            tk.Label(dialog, text="Notes", bg=self.palette["bg"], fg=self.palette["ink"]).grid(row=8, column=0, sticky="nw", padx=12, pady=4)
            notes = tk.Text(dialog, width=32, height=4, bg=self.palette["card"], fg=self.palette["ink"], relief="flat")
            notes.grid(row=8, column=1, padx=12, pady=4)
            notes.insert("1.0", notes_value)
            error = tk.Label(dialog, text="", bg=self.palette["bg"], fg=self.palette["accent"])
            error.grid(row=9, column=0, columnspan=2, sticky="w", padx=12)

            def save() -> None:
                heading = title_entry.get().strip()
                if not heading:
                    error.configure(text="Add a title.")
                    return
                try:
                    start_day = datetime.strptime(date_entry.get().strip(), "%Y-%m-%d").date()
                    stop_day = datetime.strptime(end_date_entry.get().strip(), "%Y-%m-%d").date()
                    start_time = datetime.strptime(start_entry.get().strip(), "%H:%M").time()
                    end_time = datetime.strptime(end_entry.get().strip(), "%H:%M").time()
                except ValueError:
                    error.configure(text="Use YYYY-MM-DD and HH:MM.")
                    return
                if all_day_var.get():
                    if stop_day < start_day:
                        error.configure(text="End date needs to be on or after the start.")
                        return
                    payload = {
                        "start": start_day.isoformat(),
                        "end": (stop_day + timedelta(days=1)).isoformat(),
                        "allDay": True,
                    }
                else:
                    start_dt = datetime.combine(start_day, start_time).replace(tzinfo=local_tz())
                    end_dt = datetime.combine(start_day, end_time).replace(tzinfo=local_tz())
                    if end_dt <= start_dt:
                        error.configure(text="End time needs to be after the start.")
                        return
                    payload = {"start": start_dt.isoformat(), "end": end_dt.isoformat(), "allDay": False}
                event_id = existing.get("id") if existing else (occurrence.event_id if occurrence else new_id())
                record = {"id": event_id, "title": heading, "location": location_entry.get().strip(), "notes": notes.get("1.0", "end").strip(), **payload}
                target = chosen.get()
                if existing and calendar_id != target:
                    for calendar in self.app_cals:
                        if calendar["id"] == calendar_id:
                            calendar["events"] = [event for event in calendar["events"] if event.get("id") != event_id]
                for calendar in self.app_cals:
                    if calendar["id"] != target:
                        continue
                    events = calendar.setdefault("events", [])
                    for index, event in enumerate(events):
                        if event.get("id") == event_id:
                            events[index] = record
                            break
                    else:
                        events.append(record)
                self.anchor = start_day
                self.persist()
                self.update_period()
                self.redraw()
                dialog.destroy()

            def delete() -> None:
                if not existing:
                    dialog.destroy()
                    return
                for calendar in self.app_cals:
                    calendar["events"] = [event for event in calendar.get("events", []) if event.get("id") != existing.get("id")]
                self.persist()
                self.redraw()
                dialog.destroy()

            tk.Button(dialog, text="Save", command=save, bg=self.palette["accent"], fg=self.palette["accent_fg"], relief="flat").grid(row=10, column=1, sticky="e", padx=12, pady=12)
            if existing:
                tk.Button(dialog, text="Delete", command=delete, bg=self.palette["bg"], fg=self.palette["accent"], relief="flat").grid(row=10, column=0, sticky="w", padx=12, pady=12)
            menu.configure(bg=self.palette["card"])
            _ = names

    if "--check" in sys.argv:
        _self_check()
        return
    Meridian().mainloop()


if __name__ == "__main__":
    if "--check" in sys.argv:
        _self_check()
    else:
        main()
