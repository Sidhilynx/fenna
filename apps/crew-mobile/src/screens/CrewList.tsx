// The Crew tab: every bot (face, name, what it is doing) and the group
// chats. "+" makes a bot or a group chat.

import { useState } from "react";
import { useStore } from "../state.tsx";
import { ConnBar, Empty, Face, Header, PixelIcon, Row, Section, Sheet, Working } from "../ui.tsx";

export function CrewList() {
  const { overview, link, push } = useStore();
  const [adding, setAdding] = useState(false);
  const name = (slug: string) => overview?.bots.find((b) => b.slug === slug)?.name ?? slug;

  return (
    <>
      <Header title="Crew" sub={link.computerName || undefined} />
      <ConnBar />
      <div className="m-body crew-body">
        {!overview ? (
          <div className="crew-loading">
            <Working label="Loading your crew" />
          </div>
        ) : !overview.bots.length ? (
          <Empty title="No bots yet" sub="Make one: say what it should do, and when.">
            <button type="button" className="btn primary" onClick={() => push({ name: "newbot" })} disabled={!link.ready}>
              New bot
            </button>
          </Empty>
        ) : (
          <>
            <Section>
              {overview.bots.map((b) => (
                <Row
                  key={b.slug}
                  lead={<Face avatar={b.avatar} color={b.color} mood={b.mood} size={40} />}
                  title={b.name}
                  sub={b.statusLine || b.job}
                  right={b.running ? <Working label="Working" /> : undefined}
                  onClick={() => push({ name: "chat", slug: b.slug })}
                />
              ))}
            </Section>
            {overview.teams.length > 0 && (
              <Section title="Group chats">
                {overview.teams.map((t) => (
                  <Row
                    key={t.slug}
                    lead={
                      <span className="crew-group-icon">
                        <PixelIcon name="group" size={20} />
                      </span>
                    }
                    title={t.name}
                    sub={`${name(t.lead)} leads · ${t.members.length + 1} bots`}
                    onClick={() => push({ name: "group", slug: t.slug })}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
      {overview && overview.bots.length > 0 && (
        <button type="button" className="m-fab" aria-label="New" onClick={() => setAdding(true)} disabled={!link.ready}>
          <PixelIcon name="plus" size={24} />
        </button>
      )}
      {adding && (
        <Sheet title="New" onClose={() => setAdding(false)}>
          <Row
            lead={<PixelIcon name="bots" size={20} />}
            title="New bot"
            sub="One job, its own browser and files, a schedule."
            onClick={() => {
              setAdding(false);
              push({ name: "newbot" });
            }}
          />
          <Row
            lead={<PixelIcon name="group" size={20} />}
            title="New group chat"
            sub="A lead hands work to the others."
            onClick={() => {
              setAdding(false);
              push({ name: "newgroup" });
            }}
          />
        </Sheet>
      )}
    </>
  );
}
