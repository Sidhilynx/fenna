// A group chat (a team): its thread, the composer with @mentions, the members,
// rename and delete. And the form that starts a new one.

import "./settings.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorText, invoke, on } from "../../../crew/src/shared/api.ts";
import type { ThreadMessage } from "../../../crew/src/shared/contract.ts";
import { openMention, splitMentions, type Piece } from "../../../crew/src/renderer/mentions.ts";
import { plural } from "../../../crew/src/renderer/text.ts";
import { useAct, useStore } from "../state.tsx";
import { ConnBar, Empty, Face, haptic, Header, IconButton, PixelIcon, Sheet, Working } from "../ui.tsx";

/** A message's text with its @mentions marked. */
function Mentioned({ pieces }: { pieces: Piece[] }) {
  return (
    <>
      {pieces.map((p, k) => (p.slug === undefined ? <span key={k}>{p.text}</span> : <span key={k} className="st-mention">{p.text}</span>))}
    </>
  );
}

export function Group({ slug }: { slug: string }) {
  const { overview, link, bot, toast, home } = useStore();
  const act = useAct();
  const team = overview?.teams.find((t) => t.slug === slug) ?? null;
  const memberSlugs = team ? [team.lead, ...team.members] : [];
  const membersKey = memberSlugs.join("\n");
  const bots = memberSlugs.flatMap((s) => {
    const b = bot(s);
    return b ? [b] : [];
  });

  const [thread, setThread] = useState<ThreadMessage[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [sending, setSending] = useState(false);
  const [more, setMore] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const field = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);

  const load = useCallback(
    () =>
      invoke("crew:teamThread", slug).then(
        (t) => {
          setThread(t);
          setLoadError("");
        },
        (e: unknown) => setLoadError(errorText(e)),
      ),
    [slug],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A run of the lead or a member, or any change, reloads the thread (debounced).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 300);
    };
    const offEvent = on("crew:event", (e) => {
      if (membersKey.split("\n").includes(e.slug)) soon();
    });
    const offChanged = on("crew:changed", soon);
    return () => {
      clearTimeout(timer);
      offEvent();
      offChanged();
    };
  }, [load, membersKey]);

  // The newest message shows, as long as the person is at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [thread]);

  // The composer grows to five lines, then scrolls.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const max = parseFloat(cs.lineHeight) * 5 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [draft]);

  if (!team) {
    return (
      <>
        <Header back title="Group chat" />
        <ConnBar />
        <div className="m-body">
          <Empty title="This group chat is gone" />
        </div>
      </>
    );
  }

  const ready = link.ready;
  const leadName = bot(team.lead)?.name ?? team.lead;
  const busy = bots.some((b) => b.running || b.queued);
  const mention = openMention(draft, caret);
  const choices = mention ? bots.filter((b) => b.name.toLowerCase().includes(mention.query.toLowerCase())) : [];
  const targets = bots.map((b) => ({ name: b.name, slug: b.slug }));
  const text = draft.trim();
  const canSend = ready && text !== "" && !sending;
  const newName = (rename ?? team.name).trim();

  function pick(name: string) {
    if (!mention) return;
    const at = mention.start + name.length + 2;
    pendingCaret.current = at;
    setDraft(`${draft.slice(0, mention.start)}@${name} ${draft.slice(caret)}`);
    setCaret(at);
  }

  async function send() {
    if (!canSend) return;
    const sentAs = draft;
    setSending(true);
    const r = await act(invoke("crew:teamSend", slug, text));
    setSending(false);
    if (!r) {
      haptic("fail");
      return;
    }
    atBottom.current = true;
    haptic("ok");
    // The text stays in the box until the computer has it; typing since then is kept.
    setDraft((d) => (d === sentAs ? "" : d));
    setCaret(0);
    void load();
  }

  async function saveName() {
    const r = await act(invoke("crew:teamUpdate", slug, { name: newName }));
    if (r) {
      setRename(null);
      toast("Renamed");
    }
  }

  async function remove() {
    const r = await act(invoke("crew:teamDelete", slug));
    if (r) {
      toast("Deleted");
      home();
    }
  }

  return (
    <>
      <Header
        back
        title={team.name}
        sub={`Lead: ${leadName} · ${plural(bots.length, "bot")}`}
        actions={<IconButton icon="more" label="More" onClick={() => setMore(true)} />}
      />
      <ConnBar />
      <div
        className="m-body"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        <div className="st-thread">
          {thread === null && !loadError && (
            <div className="st-loading">
              <Working label="Loading" />
            </div>
          )}
          {loadError && <Empty title="Couldn't load this group chat" sub={loadError} />}
          {thread?.length === 0 && <p className="st-note">Nothing said yet.</p>}
          {thread?.map((m, i) => {
            if (m.from === "person") {
              return (
                <div key={i} className="st-msg-you">
                  <Mentioned pieces={splitMentions(m.text, targets)} />
                </div>
              );
            }
            const sender = bot(m.from);
            return (
              <div key={i} className="st-msg-bot">
                {sender && <Face avatar={sender.avatar} color={sender.color} mood={sender.mood} size={28} title={sender.name} />}
                <div className="st-msg-bot-text">
                  <span className="st-msg-name">{sender?.name ?? m.from}</span>
                  <span className="st-msg-body">
                    <Mentioned pieces={splitMentions(m.text, targets)} />
                  </span>
                </div>
              </div>
            );
          })}
          {busy && (
            <div className="st-working">
              <Working label="The group is working" />
              <span>The group is working</span>
            </div>
          )}
        </div>
      </div>

      {mention && choices.length > 0 && (
        <div className="st-mentions" role="group" aria-label="Mention a bot">
          {choices.map((b) => (
            <button key={b.slug} type="button" className="st-chip" onClick={() => pick(b.name)}>
              <Face avatar={b.avatar} color={b.color} mood={b.mood} size={20} title={b.name} />
              <span>{b.name}</span>
            </button>
          ))}
        </div>
      )}
      {!ready && <p className="m-help st-reason">Connect to your computer to send.</p>}
      <div className="composer">
        <textarea
          ref={field}
          className="field composer-box"
          rows={1}
          value={draft}
          placeholder="Message the group"
          aria-label="Message the group"
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionEnd);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionEnd)}
        />
        <button type="button" className="composer-send" aria-label="Send" disabled={!canSend} onClick={() => void send()}>
          <PixelIcon name="send" size={20} />
        </button>
      </div>

      {more && (
        <Sheet title="Group chat" onClose={() => setMore(false)}>
          <h3 className="st-group-title">Members</h3>
          <ul className="st-members">
            {bots.map((b) => (
              <li key={b.slug} className="st-member">
                <Face avatar={b.avatar} color={b.color} mood={b.mood} size={28} title={b.name} />
                <span className="st-pick-name">{b.name}</span>
                {b.slug === team.lead && <span className="px-tag">Lead</span>}
              </li>
            ))}
          </ul>

          <h3 className="st-group-title">Name</h3>
          <label className="m-field">
            <input className="field" value={rename ?? team.name} maxLength={40} onChange={(e) => setRename(e.target.value)} aria-label="Name" />
          </label>
          <button type="button" className="btn primary" disabled={!ready || !newName || newName === team.name} onClick={() => void saveName()}>
            Rename
          </button>

          <div className="st-actions">
            <button
              type="button"
              className="btn m-danger"
              disabled={!ready}
              onClick={() => {
                setMore(false);
                setConfirmDelete(true);
              }}
            >
              Delete group chat
            </button>
          </div>
          {!ready && <p className="m-help st-reason">Connect to your computer to change this.</p>}
        </Sheet>
      )}

      {confirmDelete && (
        <Sheet
          title={`Delete ${team.name}?`}
          onClose={() => setConfirmDelete(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button type="button" className="btn m-danger-fill" onClick={() => void remove()}>
                Delete
              </button>
            </>
          }
        >
          <p className="st-sec-note">Its messages are deleted from this computer. Its bots stay.</p>
        </Sheet>
      )}
    </>
  );
}

export function NewGroup() {
  const { overview, link, pop, push, toast } = useStore();
  const act = useAct();
  const bots = overview?.bots ?? [];
  const [name, setName] = useState("");
  const [lead, setLead] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);

  const missing = !name.trim() ? "Give the group chat a name." : !lead ? "Choose a lead bot." : "";
  const reason = !link.ready ? "Connect to your computer to make changes." : missing;
  const canCreate = link.ready && !missing && !busy;
  const others = bots.filter((b) => b.slug !== lead);

  function chooseLead(slug: string) {
    setLead(slug);
    setMembers((m) => m.filter((s) => s !== slug));
  }

  function toggle(slug: string, on: boolean) {
    setMembers((m) => (on ? [...m, slug] : m.filter((s) => s !== slug)));
  }

  async function create() {
    setBusy(true);
    const r = await act(invoke("crew:teamCreate", { name: name.trim(), lead, members, purpose: purpose.trim() }));
    setBusy(false);
    if (!r) return;
    toast("Created");
    pop();
    push({ name: "group", slug: r.slug });
  }

  return (
    <>
      <Header back title="New group chat" />
      <ConnBar />
      <div className="m-body pad">
        {bots.length === 0 ? (
          <Empty title="No bots yet" sub="Make a bot first, then group it." />
        ) : (
          <>
            <label className="m-field">
              <span className="m-label">Name</span>
              <input className="field" value={name} maxLength={40} autoComplete="off" onChange={(e) => setName(e.target.value)} />
            </label>

            <fieldset className="st-fieldset">
              <legend className="m-label">Lead</legend>
              <div className="st-pick">
                {bots.map((b) => (
                  <label key={b.slug} className="st-pick-line">
                    <input type="radio" name="lead" checked={lead === b.slug} onChange={() => chooseLead(b.slug)} />
                    <Face avatar={b.avatar} color={b.color} mood={b.mood} size={24} title={b.name} />
                    <span className="st-pick-name">{b.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="st-fieldset">
              <legend className="m-label">Members</legend>
              {others.length === 0 ? (
                <p className="m-help">Make another bot to add members.</p>
              ) : (
                <div className="st-pick">
                  {others.map((b) => (
                    <label key={b.slug} className="st-pick-line">
                      <input type="checkbox" checked={members.includes(b.slug)} onChange={(e) => toggle(b.slug, e.target.checked)} />
                      <Face avatar={b.avatar} color={b.color} mood={b.mood} size={24} title={b.name} />
                      <span className="st-pick-name">{b.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <label className="m-field">
              <span className="m-label">Purpose (optional)</span>
              <textarea className="field" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            </label>
          </>
        )}
      </div>
      <div className="st-foot">
        {reason && <p className="m-help">{reason}</p>}
        <button type="button" className="btn primary" disabled={!canCreate} onClick={() => void create()}>
          Create
        </button>
      </div>
    </>
  );
}
