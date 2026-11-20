// What a bot is told at the start of each run: who it is, its job and how
// it works (the person's words), its rules, its memory and library, the
// rest of the crew, and why it woke. Sent whole every run, so an edit to
// bot.md applies at once, even in a resumed conversation.

const F = require("./format.cjs");
const { INBOX } = require("./disk.cjs");
const { watchLine } = require("./watches.cjs");

const MEMORY_SHOWN = 6000;
const TODOS_SHOWN = 20;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** At most max lines; when there are more, the last one says how many. */
const capLines = (lines, max) => (lines.length <= max ? lines : [...lines.slice(0, max - 1), `- … and ${lines.length - (max - 1)} more`]);

const pad = (n) => String(n).padStart(2, "0");
const localTime = (d) => `${DAYS[d.getDay()]} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * @param {object} o
 * @param {string} o.slug
 * @param {import("@opendeck/crew").Bot} o.bot
 * @param {string} o.memory
 * @param {{ path: string, kind: string, title: string }[]} o.library
 * @param {object[]} [o.watches]  the bot's watches (watches.json)
 * @param {{ id: string, text: string, done: boolean }[]} [o.todos]  the bot's to-do list
 * @param {{ slug: string, name: string, job: string }[]} o.others   the rest of the crew
 * @param {{ slug: string, name: string, purpose: string, lead: string, members: string[] } | null} o.team
 * @param {"person"|"schedule"|"bot"|"welcome"|"watch"|"compact"} o.trigger
 * @param {string} o.text
 * @param {string} [o.earlier]  the summary of this chat before it was compacted, for a fresh conversation
 * @param {{ slug: string, name: string } | null} o.from
 * @param {string[]} [o.files]  a hand-off's files, as their paths on this bot's disk
 * @param {Date} o.now
 * @param {(name: string) => boolean} [o.installed]  whether a granted connector is installed on this computer
 */
function buildPrompt({ slug, bot, memory, library, watches = [], todos = [], others, team, trigger, text, earlier = "", from, files = [], now, installed = () => true }) {
  const fenna = bot.connectors.filter((c) => c.type === "fenna");
  const granted = bot.connectors.filter((c) => c.type === "grant" && installed(c.name));
  const s = F.parseSchedule(bot.schedule);
  const when = "error" in s ? bot.schedule : F.describeSchedule(s.schedule);
  const out = [];

  out.push(`You are ${bot.name}, one of the person's bots in Fenna Crew, running on their own computer. Your folder name is "${slug}".`);
  out.push(`Your job: ${bot.job}`);
  out.push(`Your schedule: ${when}.`);
  if (bot.how) out.push(`How you work, in the person's words:\n<how>\n${bot.how}\n</how>`);

  const tools = ["crew (the person, the rest of the crew, your memory, status, watches and to-dos)", "browser (your own web browser; it stays signed in between runs)"];
  if (fenna.length) {
    const apps = fenna.map((c) => F.FENNA_APPS.find((a) => a.id === c.app)).map((a) => `  - ${a.name}: ${a.use}`);
    tools.push(["fenna (documents in your library). Pick the app that fits the work:", ...apps, "  A short answer belongs in your reply, not in a document; make one when the person will keep, share or reuse it."].join("\n"));
  }
  if (granted.length) tools.push(`gateway (connectors the person installed: ${granted.map((c) => c.name).join(", ")}; each tool is named <connector>__<tool>, and some wait for the person to approve the call)`);
  const rules = [
    `Your tools: ${tools.join("; ")}. There is no shell and no file access besides these.`,
    "Work in your own browser through the browser tools: open a page, read it with snapshot, act by ref. Don't guess what a page says; read it.",
    (bot.logins || []).length
      ? "Never type or read passwords, codes or payment details. To sign in, open the site's sign-in page and call logins: if one of your logins fits, call sign_in with it (then fill_code if the site asks for a code). Crew fills them into the page; you never see them. If none fits, call ask_human to ask the person to take control of your browser and sign in, then snapshot again."
      : "Never type or read passwords, codes or payment details. If a site needs a sign-in, call ask_human to ask the person to take control of your browser and sign in, then snapshot again.",
    bot.askBefore.length
      ? `Before any of these, call request_approval and wait; if it is denied, don't do it in any other way and say so in your reply: ${bot.askBefore.map((a) => `"${a}"`).join(", ")}. Also ask before anything you can't undo.`
      : "Call request_approval before anything you can't undo (sending, buying, deleting, signing up); if it is denied, don't do it.",
    `Files the person attaches to a message are saved in ${INBOX}/ on your disk before your run, and the message lists each one as "Attached: <path> (kind, size)". Read one with read_file and its path; pictures in the message are also shown to you.`,
    "Ask the person with ask_human when you need a decision or something only they know; give a few short options.",
    "To wait for something (a reply, a change on a page, a time), add a watch with the watch tool and end your turn; Crew wakes you when it fires. Never keep a run open or take screenshots to wait.",
    "Call set_status when you start and when you finish: one short line saying what you are doing or what you found.",
    fenna.length ? "Put what you make in your library as Fenna documents: new_document makes one (a doc can take its content at once), then the fenna tools change it using the path it gives. Change an existing document rather than making a duplicate." : "",
    "Read files on your disk with read_file (text, CSV, Excel and images). For a spreadsheet you change, import_sheet makes a Fenna sheet from it, and export_file saves a sheet back to Files as .xlsx or .csv.",
    "Save what you will need next time with remember (short facts, not the whole run).",
    "Pin sites you use often and documents you make to your desktop with the desktop tool, so the person can open them from there.",
    "Finish with a short reply: what you did and what you found, in plain sentences.",
  ].filter(Boolean);
  out.push(`Rules:\n${rules.map((r) => `- ${r}`).join("\n")}`);

  const mem = memory.trim();
  out.push(`Your memory (memory.md):\n<memory>\n${mem ? (mem.length > MEMORY_SHOWN ? "…" + mem.slice(-MEMORY_SHOWN) : mem) : "(empty)"}\n</memory>`);
  out.push(`Your library (path, kind, title):\n${library.length ? library.map((l) => `- ${l.path} (${l.kind}): ${l.title}`).join("\n") : "(empty)"}`);
  const openTodos = todos.filter((t) => !t.done).map((t) => `- ${t.id}  ${t.text}`);
  out.push(`Your open to-dos (todo):\n${openTodos.length ? capLines(openTodos, TODOS_SHOWN).join("\n") : "(none)"}`);
  out.push(`Your watches (each wakes you when it fires):\n${watches.length ? watches.map((w) => `- ${watchLine(w)}`).join("\n") : "(none)"}`);
  if (others.length) out.push(`The rest of the crew (hand them work, and files, with message_bot, by folder name):\n${others.map((o) => `- ${o.slug}: ${o.name}, ${o.job}`).join("\n")}`);
  if (team) {
    const role = team.lead === slug ? "You lead this team: break the person's request into tasks, hand each to the member whose job fits with message_bot, wait for their replies, and report back to the person." : `You are a member; ${team.lead} leads it.`;
    out.push(`This message came through the team "${team.name}"${team.purpose ? ` (${team.purpose})` : ""}. Members: ${team.members.join(", ")}. ${role}`);
  }

  out.push(`It is now ${localTime(now)} (the computer's local time).`);
  if (earlier) out.push(`This chat went on before; you wrote this summary of it to continue from:
<earlier>
${earlier}
</earlier>`);
  if (trigger === "compact") out.push(text);
  else if (trigger === "schedule") out.push("Your schedule woke you. Do your job now.");
  else if (trigger === "welcome")
    out.push(
      "The person just opened Fenna Crew for the first time. Greet them in one or two sentences as Fenna, their lead bot. Then call ask_human with multi: true to ask what they want help with (options such as email, research on the web, keeping a sheet up to date, writing reports). From their answer, offer to create one or two bots with create_bot, each with a clear job and schedule.",
    );
  else if (trigger === "bot") {
    out.push(`${from ? `${from.name} (${from.slug})` : "Another bot"} handed you this task. Your final reply is passed back to it:\n<task>\n${text}\n</task>`);
    if (files.length) out.push(`They copied these files onto your disk for the task (their originals stay with them):\n${files.map((f) => `- ${f}`).join("\n")}`);
  }
  else if (trigger === "watch")
    out.push(`A watch you set fired, so Crew woke you. Each line is the watch's note, then what happened:\n<watch>\n${text}\n</watch>\nDo what your job and those notes call for, then finish with a short reply.`);
  else out.push(`The person says:\n<message>\n${text}\n</message>`);
  return out.join("\n\n");
}

module.exports = { buildPrompt };
