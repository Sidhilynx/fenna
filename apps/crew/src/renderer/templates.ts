// Starting points in the New bot dialog. Each fills the form with a valid bot.
import type { Wallpaper } from "@opendeck/crew";

export interface BotTemplate {
  id: string;
  name: string;
  job: string;
  how: string;
  schedule: string;
  wallpaper: Wallpaper;
  apps: string[];
  ask: string[];
}

export const BOT_TEMPLATES: BotTemplate[] = [
  {
    id: "hn-digest",
    name: "Hacker News digest",
    job: "Read the Hacker News front page each morning and write the five stories worth my time to a doc.",
    how: "Open news.ycombinator.com, skim the top 30 stories and the comments on the busiest ones. Pick five, and for each write a title, a link and two sentences on why it matters.",
    schedule: "daily 07:00",
    wallpaper: "indigo",
    apps: ["fenna-docs"],
    ask: [],
  },
  {
    id: "page-watch",
    name: "Page watch",
    job: "Check a page every Monday and write what changed since last week.",
    how: "Open the page I name in chat, compare it with last week's notes, and write the differences in a doc. If nothing changed, say so in one line.",
    schedule: "mondays 10:00",
    wallpaper: "teal",
    apps: ["fenna-docs"],
    ask: [],
  },
  {
    id: "price-tracker",
    name: "Price tracker",
    job: "Look up the prices of a few products each weekday and log them in a sheet.",
    how: "Open each product page I list in chat, read the current price, and add a row to a sheet with the date, product and price. Mark any price that moved since the last row.",
    schedule: "weekdays 10:00",
    wallpaper: "clay",
    apps: ["fenna-sheets"],
    ask: ["Buying anything"],
  },
  {
    id: "pr-summary",
    name: "Pull request summary",
    job: "Go through the open pull requests on my repo and write a short note on each one.",
    how: "Open the repository's pull requests in the browser. For each open one, write what it changes, whether tests pass and what blocks it, in a doc.",
    schedule: "every 4h 08:00-20:00",
    wallpaper: "graphite",
    apps: ["fenna-docs"],
    ask: ["Merging or closing anything"],
  },
  {
    id: "meeting-notes",
    name: "Meeting prep",
    job: "Before my first meeting, write a one-page brief on the people and topics.",
    how: "Look at today's meetings I list in chat. For each, write who is coming, what was decided last time and what to ask, on one page in a doc.",
    schedule: "weekdays 08:00",
    wallpaper: "slate",
    apps: ["fenna-docs"],
    ask: ["Sending any email"],
  },
];
