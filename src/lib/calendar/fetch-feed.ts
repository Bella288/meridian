import { createServerFn } from "@tanstack/react-start";

const MAX_BYTES = 4_000_000;

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    host === "0.0.0.0"
  ) {
    return true;
  }
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function normalizeFeedUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Enter a calendar feed link.");
  let raw = trimmed;
  if (/^webcals:\/\//i.test(raw)) raw = `https://${raw.slice("webcals://".length)}`;
  else if (/^webcal:\/\//i.test(raw)) raw = `https://${raw.slice("webcal://".length)}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That link is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Feed links must start with https:// or webcal://.");
  }
  if (isBlockedHost(url.hostname)) throw new Error("That address can't be loaded from here.");
  return url.toString();
}

export const fetchCalendarFeed = createServerFn({ method: "POST" })
  .validator((data: { url: string }) => ({ url: normalizeFeedUrl(data.url) }))
  .handler(async ({ data }) => {
    const response = await fetch(data.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "text/calendar, text/plain, */*",
        "User-Agent": "MeridianCalendar/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`The feed replied with ${response.status}. Check that the link is a secret iCal address.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The feed was empty.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error("That feed is too large to import.");
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 8000))) {
      throw new Error(
        "That link did not return an iCalendar feed. In Google Calendar, use Settings → Integrate calendar → Secret address in iCal format. In Apple Calendar, use the share link that ends in .ics.",
      );
    }
    return { ics: text };
  });
