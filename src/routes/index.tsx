import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { CalendarApp } from "@/components/calendar/calendar-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <ClientOnly fallback={<Opening />}>
      <CalendarApp />
    </ClientOnly>
  );
}

function Opening() {
  return (
    <main className="flex h-dvh flex-col bg-paper text-ink">
      <header className="border-b border-line px-5 py-4">
        <p className="font-display text-2xl">Meridian</p>
        <p className="text-sm text-ink-soft">Opening your calendars…</p>
      </header>
    </main>
  );
}
