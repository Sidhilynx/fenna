// A group chat's thread (a team in the data): messages go to the lead, or to
// the bots @mentioned, and every reply lands here.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { errorText, invoke } from "../shared/api.ts";
import type { ThreadMessage } from "../shared/contract.ts";
import type { TeamSummary } from "../shared/contract.ts";
import { Avatar, Face } from "./Avatar.tsx";
import { Composer, type Mentionable } from "./Chat.tsx";
import { Markdown } from "./Markdown.tsx";
import { PixelDots } from "./PixelMotion.tsx";
import { splitMentions } from "./mentions.ts";
import { botOf, useCrew } from "./crew.tsx";
import { clock } from "./util.ts";
import { PixelField } from "./PixelField.tsx";

/** The lead's face with one member's, overlapped. */
export function TeamFaces({ team, size, big = false }: { team: TeamSummary; size: number; big?: boolean }) {
  const { overview } = useCrew();
  const lead = botOf(overview, team.lead);
  const first = botOf(overview, team.members[0] ?? "");
  return (
    <span className={`team-faces${big ? " big" : ""}`} aria-hidden>
      {lead && (
        <span>
          <Face avatar={lead.avatar} color={lead.color} mood={lead.mood} size={size} />
        </span>
      )}
      {first && (
        <span>
          <Face avatar={first.avatar} color={first.color} mood={first.mood} size={size} />
        </span>
      )}
    </span>
  );
}

export function TeamView({ slug }: { slug: string }) {
  const { overview, editTeam } = useCrew();
  const team = overview.teams.find((t) => t.slug === slug);
  const [thread, setThread] = useState<ThreadMessage[] | null>(null);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const members = team ? [team.lead, ...team.members] : [];
  const busy = members.some((m) => {
    const b = botOf(overview, m);
    return b && (b.running || b.queued);
  });

  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke("crew:teamThread", slug).then(
        (t) => {
          if (!alive) return;
          setThread(t);
          setError("");
        },
        (e) => alive && setError(errorText(e)),
      );
    void load();
    const timer = window.setInterval(load, busy ? 1500 : 6000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [slug, busy]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.length]);

  if (!team) return null;
  const nameOf = (s: string) => botOf(overview, s)?.name ?? s;
  const allTeamBots = [team.lead, ...team.members].map((s) => botOf(overview, s)).filter((b) => !!b);
  const targets = allTeamBots.map((b) => ({ name: b.name, slug: b.slug }));
  const mentionable: Mentionable[] = [...allTeamBots.map((b) => ({ name: b.name, avatar: b.avatar, color: b.color })), { name: "Everyone", avatar: null, color: null }];
  const colorOf = (slug: string) => (slug ? botOf(overview, slug)?.color : undefined);

  return (
    <main className="main chat team-chat px-host">
      <PixelField density={1.2} alpha={0.28} glitch={0.03} />
      <header className="chat-head">
        <TeamFaces team={team} size={20} big />
        <span className="chat-name">{team.name}</span>
        <span className="chat-job ell" title={team.purpose}>
          {team.purpose}
        </span>
        <button type="button" className="btn" onClick={() => editTeam(team)}>
          Edit group chat
        </button>
      </header>

      <div className="team-roster-bar">
        <div className="roster-chips">
          {allTeamBots.map((b) => b && (
            <div key={b.slug} className="roster-chip" title={`${b.name}: ${b.job}`}>
              <Face avatar={b.avatar} color={b.color} mood={b.mood} size={20} />
              <span className="roster-name">{b.name}</span>
              {b.slug === team.lead && <span className="px-tag">lead</span>}
            </div>
          ))}
        </div>
      </div>

      {team.diagnostics.length > 0 && (
        <div className="problems wide" role="alert">
          {team.diagnostics.map((d, i) => (
            <p key={i} className={d.severity}>
              {d.message}
            </p>
          ))}
        </div>
      )}
      <div className="messages" ref={scroller}>
        <div className="thread">
          {error && <p className="composer-error">{error}</p>}
          {thread && !thread.length && (
            <p className="thread-empty">Nothing said yet.</p>
          )}
          {thread?.map((m, i) => {
            if (m.from === "person") {
              return (
                <div key={i} className="msg you">
                  {splitMentions(m.text, targets).map((p, k) =>
                    p.slug === undefined ? (
                      p.text
                    ) : (
                      <span key={k} className="mention" style={{ "--mc": `var(--av-${colorOf(p.slug) ?? "stone"})` } as CSSProperties}>
                        {p.text}
                      </span>
                    ),
                  )}
                </div>
              );
            }
            const isLeadMsg = m.from === team.lead;
            const senderBot = botOf(overview, m.from);
            return (
              <div key={i} className={`msg bot team-msg${isLeadMsg ? " lead-msg" : ""}`}>
                {senderBot ? <Avatar avatar={senderBot.avatar} color={senderBot.color} size={24} title={senderBot.name} /> : <span />}
                <div className="msg-text">
                  <div className="msg-from team-msg-from">
                    <span className="sender-name">{nameOf(m.from)}</span>
                    {isLeadMsg && <span className="px-tag">lead</span>}
                    <span className="clock">{clock(m.at)}</span>
                  </div>
                  <Markdown text={m.text} />
                </div>
              </div>
            );
          })}
          {busy && (
            <div className="working" role="status">
              <PixelDots />
              <span>The group is working</span>
            </div>
          )}
        </div>
      </div>
      <Composer
        name={team.name}
        running={false}
        mentions={mentionable}
        hint={`Sent to ${nameOf(team.lead)}. @mention a bot to ask it directly.`}
        onSend={async (text) => {
          await invoke("crew:teamSend", slug, text);
          setThread(await invoke("crew:teamThread", slug));
        }}
      />
    </main>
  );
}
