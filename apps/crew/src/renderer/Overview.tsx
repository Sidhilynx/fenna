// Crew overview: bots that have a screen show it as a live tile, the others
// show what they did last as a list, and a banner says what waits on the person.
import type { BotSummary, Waiting } from "../shared/contract.ts";
import { Face } from "./Avatar.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { Thumb } from "./Thumb.tsx";
import { useCrew } from "./crew.tsx";
import { when, whenNext } from "./util.ts";
import { PixelField } from "./PixelField.tsx";

/** One line of state under the title; empty when there is nothing to say. */
export function summaryLine(bots: BotSummary[]): string {
  const needing = bots.filter((b) => b.mood === "need").length;
  const working = bots.filter((b) => b.mood === "work").length;
  const parts: string[] = [];
  if (needing) parts.push(`${needing} ${needing === 1 ? "needs" : "need"} you`);
  if (working) parts.push(`${working} working`);
  const next = bots
    .filter((b): b is BotSummary & { nextRun: string } => !!b.nextRun && !Number.isNaN(new Date(b.nextRun).getTime()))
    .sort((a, b) => a.nextRun.localeCompare(b.nextRun))[0];
  if (next) parts.push(`Next: ${next.name}, ${whenNext(next.nextRun)}`);
  return parts.join(". ");
}

function lastLine(bot: BotSummary): string {
  if (!bot.lastRunAt) return "Not run yet";
  const at = when(bot.lastRunAt);
  return bot.status && bot.status !== bot.statusLine ? `${at} · ${bot.status}` : at;
}

function Banner({ w }: { w: Waiting }) {
  const { go } = useCrew();
  const text = w.kind === "ask" ? `${w.botName} asks: ${w.question}` : `${w.botName} needs approval: ${w.action}`;
  return (
    <div className="banner waiting" role="status">
      <span className="banner-dot" aria-hidden />
      <span className="banner-text ell" title={text}>
        {text}
      </span>
      <button type="button" className="btn" onClick={() => go({ name: "chat", slug: w.slug })}>
        Review
      </button>
    </div>
  );
}

export function Tile({ bot }: { bot: BotSummary }) {
  const { go } = useCrew();
  return (
    <div className="tile">
      <Thumb bot={bot} label={`Watch ${bot.name} work`} onOpen={() => go({ name: "computer", slug: bot.slug })} />
      <div className="tile-meta">
        <Face avatar={bot.avatar} color={bot.color} mood={bot.mood} size={32} />
        <span className="tile-text">
          <span className="tile-name ell">{bot.name}</span>
          <span className={`tile-status ell${bot.mood === "need" ? " need" : ""}`} title={bot.statusLine}>
            {bot.statusLine}
          </span>
        </span>
        <button type="button" className="btn" onClick={() => go({ name: "chat", slug: bot.slug })} aria-label={`Chat with ${bot.name}`}>
          Chat
        </button>
      </div>
    </div>
  );
}

function Row({ bot }: { bot: BotSummary }) {
  const { go } = useCrew();
  return (
    <button type="button" className="ov-row" onClick={() => go({ name: "chat", slug: bot.slug })} aria-label={`Chat with ${bot.name}`}>
      <Face avatar={bot.avatar} color={bot.color} mood={bot.mood} size={32} />
      <span className="ov-row-text">
        <span className="tile-name ell">{bot.name}</span>
        <span className={`tile-status ell${bot.mood === "need" ? " need" : ""}`} title={bot.statusLine}>
          {bot.statusLine}
        </span>
        <span className="ov-row-last ell" title={lastLine(bot)}>
          {lastLine(bot)}
        </span>
      </span>
    </button>
  );
}

export function Overview() {
  const { overview, newBot, ready, openCli, go } = useCrew();
  const { bots, waiting } = overview;
  const summary = summaryLine(bots);
  const shown = waiting.slice(0, 3);
  const live = bots.filter((b) => b.browser);
  const rest = bots.filter((b) => !b.browser);
  return (
    <main className="main overview px-host">
      <PixelField density={2.5} alpha={0.35} />
      <div className="ov-head">
        <div className="ov-title">
          <h1>Your crew</h1>
          {summary && <p>{summary}</p>}
        </div>
      </div>
      {!ready && (
        <div className="banner" role="status">
          <span className="banner-text">Sign in to Claude Code, Codex or Antigravity.</span>
          <button type="button" className="btn primary" onClick={openCli}>
            Sign in
          </button>
        </div>
      )}
      {shown.map((w) => (
        <Banner key={w.id} w={w} />
      ))}
      {overview.offers.slice(0, 2).map((o) => {
        const site = o.origin.replace(/^https?:\/\//, "");
        return (
          <div key={o.id} className="banner waiting" role="status">
            <span className="banner-dot" aria-hidden />
            <span className="banner-text ell" title={`${o.botName} signed in to ${site}`}>
              Save the login for {site}?
            </span>
            <button type="button" className="btn" onClick={() => go({ name: "computer", slug: o.slug })}>
              Review
            </button>
          </div>
        );
      })}
      {waiting.length > shown.length && <p className="more-waiting">{waiting.length - shown.length} more waiting</p>}
      {live.length > 0 && (
        <div className="grid">
          {live.map((b) => (
            <Tile key={b.slug} bot={b} />
          ))}
          {!rest.length && <NewTile onClick={newBot} />}
        </div>
      )}
      {(rest.length > 0 || !live.length) && (
        <div className="ov-list">
          {rest.map((b) => (
            <Row key={b.slug} bot={b} />
          ))}
          <button type="button" className="ov-new" onClick={newBot}>
            <PixelIcon name="plus" size={14} />
            New bot
          </button>
        </div>
      )}
    </main>
  );
}

/** The dashed edge is a row of 2px squares: a dashed stroke on a 2px line, not a CSS dashed border. */
function NewTile({ onClick }: { onClick(): void }) {
  return (
    <button type="button" className="tile-new" onClick={onClick}>
      <svg className="tile-new-edge" aria-hidden focusable="false">
        <rect x="1" y="1" />
      </svg>
      <PixelIcon name="plus" size={22} />
      <span className="tile-new-title">New bot</span>
    </button>
  );
}
