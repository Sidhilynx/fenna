// When a bot wakes on its own. The grammar, one line in bot.md:
//
//   manual                       only when someone asks
//   daily 08:00                  every day
//   weekdays 09:00, 13:00        Monday to Friday, at each time listed
//   mondays 10:00                one day of the week (sundays … saturdays)
//   every 2h 08:00-18:00         every N hours inside a window, every day
//
// Times are the computer's local wall clock, 24-hour. All math is done on
// local date fields, so a daylight-saving change never shifts a run.

export const DAY_NAMES = ["sundays", "mondays", "tuesdays", "wednesdays", "thursdays", "fridays", "saturdays"] as const;
const DAY_LABELS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const MAX_TIMES = 12;
export const SCHEDULE_EXAMPLES = ["manual", "daily 08:00", "weekdays 09:00, 13:00", "mondays 10:00", "every 2h 08:00-18:00"] as const;

/** Minutes after midnight. */
type Minutes = number;

export type Schedule =
  | { kind: "manual" }
  | { kind: "days"; days: number[]; times: Minutes[] }
  | { kind: "every"; hours: number; from: Minutes; to: Minutes };

const HELP = `Write one of: ${SCHEDULE_EXAMPLES.map((e) => `\`${e}\``).join(", ")}.`;

function time(t: string): Minutes | string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return `"${t.trim()}" is not a time. Write times as HH:MM, 24-hour, like 09:00 or 17:30.`;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return `"${t.trim()}" is not a time of day. Hours go 00 to 23 and minutes 00 to 59.`;
  return h * 60 + min;
}

const hhmm = (m: Minutes) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function times(rest: string): Minutes[] | string {
  if (!rest.trim()) return `Add a time, like \`weekdays 09:00\`.`;
  const out: Minutes[] = [];
  for (const part of rest.split(",")) {
    const t = time(part);
    if (typeof t === "string") return t;
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > MAX_TIMES) return `At most ${MAX_TIMES} times a day. For more, use \`every 1h 08:00-18:00\`.`;
  return out.sort((a, b) => a - b);
}

/** Read a schedule line. Errors say what to write instead. */
export function parseSchedule(text: unknown): { schedule: Schedule } | { error: string } {
  if (typeof text !== "string" || !text.trim()) return { error: `The schedule is empty. ${HELP}` };
  const src = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (src === "manual") return { schedule: { kind: "manual" } };
  const sp = src.indexOf(" ");
  const head = sp < 0 ? src : src.slice(0, sp);
  const rest = sp < 0 ? "" : src.slice(sp + 1);
  if (head === "every") {
    const m = /^(\d{1,2})h (\S+)-(\S+)$/.exec(rest);
    if (!m) {
      if (/^\d{1,2}h$/.test(rest)) return { error: `Add the hours it runs in, like \`every ${rest} 08:00-18:00\`.` };
      if (/^\d+ ?(m|min|minutes?)\b/.test(rest)) return { error: "The shortest repeat is every hour: `every 1h 08:00-18:00`." };
      return { error: `Write repeats as \`every 2h 08:00-18:00\`: hours, then the window they run in.` };
    }
    const hours = Number(m[1]);
    if (hours < 1 || hours > 12) return { error: "Repeat every 1 to 12 hours, like `every 2h 08:00-18:00`." };
    const from = time(m[2]!);
    if (typeof from === "string") return { error: from };
    const to = time(m[3]!);
    if (typeof to === "string") return { error: to };
    if (to <= from) return { error: `The window must end after it starts: ${hhmm(from)}-${hhmm(to)} ends first. Write the earlier time first.` };
    return { schedule: { kind: "every", hours, from, to } };
  }
  let days: number[] | null = null;
  if (head === "daily") days = ALL_DAYS;
  else if (head === "weekdays") days = WEEKDAYS;
  else {
    const d = DAY_NAMES.indexOf(head as (typeof DAY_NAMES)[number]);
    if (d >= 0) days = [d];
    else {
      const single = DAY_NAMES.findIndex((n) => n === `${head}s`);
      if (single >= 0) return { error: `Write the day as \`${DAY_NAMES[single]} ${rest || "10:00"}\` (plural: every ${DAY_LABELS[single]!.slice(0, -1)}).` };
      if (/^\d/.test(head)) return { error: `Say which days first, like \`daily ${src}\` or \`weekdays ${src}\`.` };
      return { error: `"${head}" is not a schedule. ${HELP}` };
    }
  }
  const t = times(rest);
  if (typeof t === "string") return { error: t };
  return { schedule: { kind: "days", days, times: t } };
}

/** The canonical line for a schedule, as bot.md keeps it. */
export function formatSchedule(s: Schedule): string {
  if (s.kind === "manual") return "manual";
  if (s.kind === "every") return `every ${s.hours}h ${hhmm(s.from)}-${hhmm(s.to)}`;
  const t = s.times.map(hhmm).join(", ");
  if (s.days.length === 7) return `daily ${t}`;
  if (s.days.length === 5 && WEEKDAYS.every((d) => s.days.includes(d))) return `weekdays ${t}`;
  return `${DAY_NAMES[s.days[0]!]} ${t}`;
}

function andList(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The schedule in plain words: "Weekdays at 09:00 and 13:00". */
export function describeSchedule(s: Schedule): string {
  if (s.kind === "manual") return "Only when asked";
  if (s.kind === "every") return `Every ${s.hours === 1 ? "hour" : `${s.hours} hours`}, ${hhmm(s.from)} to ${hhmm(s.to)}`;
  const at = `at ${andList(s.times.map(hhmm))}`;
  if (s.days.length === 7) return `Every day ${at}`;
  if (s.days.length === 5) return `Weekdays ${at}`;
  return `${DAY_LABELS[s.days[0]!]} ${at}`;
}

function slotsOn(s: Exclude<Schedule, { kind: "manual" }>, weekday: number): Minutes[] {
  if (s.kind === "days") return s.days.includes(weekday) ? s.times : [];
  const out: Minutes[] = [];
  for (let m = s.from; m <= s.to; m += s.hours * 60) out.push(m);
  return out;
}

/** The first time strictly after `from` that the schedule wakes the bot; null for manual. */
export function nextRun(s: Schedule, from: Date): Date | null {
  if (s.kind === "manual") return null;
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    for (const m of slotsOn(s, day.getDay())) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60);
      if (at.getTime() > from.getTime()) return at;
    }
  }
  return null;
}
