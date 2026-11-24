// Everything waiting on the person, newest first, answered in place:
// questions, approvals and offers to save a login.

import { useMemo } from "react";
import { when } from "../../../crew/src/renderer/text.ts";
import type { SaveOffer, Waiting } from "../../../crew/src/shared/contract.ts";
import { useStore } from "../state.tsx";
import { ConnBar, Empty, Face, Header } from "../ui.tsx";
import { ApprovalCard, AskCard, OfferCard } from "./Cards.tsx";

type Entry = { at: string; slug: string; botName: string; key: string } & ({ wait: Waiting } | { offer: SaveOffer });

export function Inbox() {
  const { overview, bot, push } = useStore();
  const entries = useMemo<Entry[]>(() => {
    if (!overview) return [];
    const list: Entry[] = [
      ...overview.waiting.map((w) => ({ at: w.at, slug: w.slug, botName: w.botName, key: w.id, wait: w })),
      ...overview.offers.map((o) => ({ at: o.at, slug: o.slug, botName: o.botName, key: `offer:${o.id}`, offer: o })),
    ];
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [overview]);

  return (
    <>
      <Header title="Inbox" sub={entries.length ? `${entries.length} waiting on you` : undefined} />
      <ConnBar />
      <div className="m-body pad">
        {!overview ? null : !entries.length ? (
          <Empty title="Nothing needs you" sub="When a bot asks something or needs your approval, it shows here." />
        ) : (
          <ul className="inbox">
            {entries.map((e) => {
              const b = bot(e.slug);
              return (
                <li key={e.key} className="inbox-item">
                  <button type="button" className="inbox-who" onClick={() => push({ name: "chat", slug: e.slug })}>
                    {b && <Face avatar={b.avatar} color={b.color} mood={b.mood} size={24} />}
                    <span className="grow ell">{e.botName}</span>
                    <span className="inbox-when">{when(e.at)}</span>
                  </button>
                  {"wait" in e ? (
                    e.wait.kind === "ask" ? (
                      <AskCard id={e.wait.id} question={e.wait.question} options={e.wait.options} multi={e.wait.multi} answer={null} />
                    ) : (
                      <ApprovalCard id={e.wait.id} action={e.wait.action} details={e.wait.details} source={e.wait.source} decision={null} />
                    )
                  ) : (
                    <OfferCard id={e.offer.id} origin={e.offer.origin} username={e.offer.username} existing={e.offer.existing} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
