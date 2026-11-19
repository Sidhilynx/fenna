// Making things: a new bot (one form), and a group chat (create or edit).

import { useEffect, useRef, useState } from "react";
import { Dialog, MenuButton } from "@opendeck/shell";
import { FENNA_APPS, LIMITS, SCHEDULE_EXAMPLES, WALLPAPERS, parseSchedule, type Connector, type Wallpaper } from "@opendeck/crew";
import { errorText, invoke } from "../shared/api.ts";
import type { TeamSummary } from "../shared/contract.ts";
import { Face } from "./Avatar.tsx";
import { BrainPicker, type Brain } from "./BrainPicker.tsx";
import { FaceButton, suggestFace } from "./FacePicker.tsx";
import { PixelIcon } from "./PixelIcon.tsx";
import { KIND_ICON } from "./pixelIcons.ts";
import { BOT_TEMPLATES, type BotTemplate } from "./templates.ts";
import { useCrew } from "./crew.tsx";

export function NewBotDialog({ onClose }: { onClose(): void }) {
  const { go, clis, overview, newTeam } = useCrew();
  const [face, setFace] = useState(() => suggestFace(overview.bots));
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [how, setHow] = useState("");
  const [schedule, setSchedule] = useState("manual");
  const [brain, setBrain] = useState<Brain>(() => ({ cli: clis.find((c) => c.installed && c.signedIn !== false)?.kind ?? "claude", model: "", effort: "" }));
  const [apps, setApps] = useState<string[]>(() => FENNA_APPS.map((a) => a.id));
  const [ask, setAsk] = useState<string[]>([]);
  const [askText, setAskText] = useState("");
  const [wallpaper, setWallpaper] = useState<Wallpaper>(WALLPAPERS[0]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const jobRef = useRef<HTMLInputElement>(null);
  const scheduleRef = useRef<HTMLInputElement>(null);

  // The person's defaults from Settings, when they set one and it can answer.
  useEffect(() => {
    let live = true;
    invoke("crew:settings").then((s) => {
      if (!live || !s.defaultCli) return;
      const c = clis.find((x) => x.kind === s.defaultCli);
      if (!c || !c.installed || c.signedIn === false) return;
      setBrain({ cli: s.defaultCli, model: s.defaultModel || "", effort: s.defaultEffort || "" });
    }, () => undefined);
    return () => {
      live = false;
    };
  }, []);

  const parsed = parseSchedule(schedule);
  const scheduleError = "error" in parsed ? parsed.error : "";

  const addAsk = () => {
    const t = askText.trim();
    if (t && !ask.includes(t)) setAsk([...ask, t]);
    setAskText("");
  };

  const fill = (t: BotTemplate) => {
    setName(t.name);
    setJob(t.job);
    setHow(t.how);
    setSchedule(t.schedule);
    setWallpaper(t.wallpaper);
    setApps(t.apps);
    setAsk(t.ask);
    setMore(true);
    setError("");
    nameRef.current?.focus();
  };

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) {
      setError("Give the bot a name and one job.");
      nameRef.current?.focus();
      return;
    }
    if (!job.trim()) {
      setError("Give the bot a name and one job.");
      jobRef.current?.focus();
      return;
    }
    if (scheduleError) {
      setError("");
      scheduleRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const pending = askText.trim();
      const askBefore = pending && !ask.includes(pending) ? [...ask, pending] : ask;
      const connectors: Connector[] = FENNA_APPS.filter((a) => apps.includes(a.id)).map((a) => ({ type: "fenna", app: a.id }));
      const { slug } = await invoke("crew:create", {
        name: name.trim(),
        job: job.trim(),
        how: how.trim(),
        schedule: schedule.trim(),
        ...brain,
        connectors,
        askBefore,
        wallpaper,
        avatar: face.avatar,
        color: face.color,
      });
      onClose();
      go({ name: "chat", slug });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title="New bot" onClose={onClose} width={560}>
      <form
        className="nb-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <section className="nb-section">
          <h3 className="nb-title">Start from</h3>
          <ul className="nb-start">
            {BOT_TEMPLATES.map((t) => (
              <li key={t.id}>
                <button type="button" className="nb-start-item" title={t.job} onClick={() => fill(t)}>
                  <span className="nb-start-name">{t.name}</span>
                  <span className="nb-start-job ell">{t.job}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className="nb-name-row">
          <FaceButton avatar={face.avatar} color={face.color} size={48} onChange={setFace} />
          <div className="nb-field">
            <label className="nb-title" htmlFor="nb-name">Name</label>
            <input
              id="nb-name"
              ref={nameRef}
              className="field"
              value={name}
              maxLength={LIMITS.name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Research"
              data-autofocus
            />
          </div>
        </div>

        <div className="nb-field">
          <label className="nb-title" htmlFor="nb-job">Job</label>
          <input
            id="nb-job"
            ref={jobRef}
            className="field"
            value={job}
            maxLength={LIMITS.job}
            onChange={(e) => setJob(e.target.value)}
            placeholder="Check a page every Monday and write what changed"
          />
        </div>

        <div className="nb-field">
          <label className="nb-title" htmlFor="nb-schedule">Schedule</label>
          <span className="inline">
            <input
              id="nb-schedule"
              ref={scheduleRef}
              className="field"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              spellCheck={false}
              aria-invalid={scheduleError ? true : undefined}
              aria-describedby={scheduleError ? "nb-schedule-error" : undefined}
            />
            <MenuButton
              className="btn nb-sched-more"
              label="Schedule examples"
              align="end"
              entries={SCHEDULE_EXAMPLES.map((s) => ({
                label: s,
                checked: s === schedule,
                onSelect: () => setSchedule(s),
              }))}
            >
              <PixelIcon name="chevron-down" size={12} />
            </MenuButton>
          </span>
          {scheduleError && (
            <p id="nb-schedule-error" className="form-error nb-error">
              {scheduleError}
            </p>
          )}
        </div>

        <div className="nb-field">
          <span className="nb-title">Brain</span>
          <BrainPicker value={brain} clis={clis} onChange={setBrain} />
        </div>

        <button type="button" className="nb-more" aria-expanded={more} aria-controls="nb-more" onClick={() => setMore(!more)}>
          More
          <PixelIcon name="chevron-down" size={12} />
        </button>

        {more && (
          <div id="nb-more" className="nb-more-body">
            <div className="nb-field">
              <label className="nb-title" htmlFor="nb-how">How it works</label>
              <textarea
                id="nb-how"
                className="field area"
                rows={4}
                value={how}
                onChange={(e) => setHow(e.target.value)}
                placeholder="Steps to take"
              />
            </div>

            <fieldset className="nb-field nb-fieldset">
              <legend className="nb-title">Fenna apps</legend>
              <span className="toggles">
                {FENNA_APPS.map((a) => {
                  const on = apps.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className="toggle"
                      aria-pressed={on}
                      onClick={() => setApps(on ? apps.filter((x) => x !== a.id) : [...apps, a.id])}
                    >
                      <PixelIcon name={KIND_ICON[a.kind]} size={14} />
                      {a.name}
                    </button>
                  );
                })}
              </span>
            </fieldset>

            <div className="nb-field">
              <label className="nb-title" htmlFor="nb-ask">Ask me before</label>
              {ask.length > 0 && (
                <ul className="chips">
                  {ask.map((a) => (
                    <li key={a} className="chip">
                      <span className="ell">{a}</span>
                      <button type="button" className="icon-btn" aria-label={`Remove ${a}`} onClick={() => setAsk(ask.filter((x) => x !== a))}>
                        <PixelIcon name="close" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <span className="inline">
                <input
                  id="nb-ask"
                  className="field"
                  value={askText}
                  onChange={(e) => setAskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addAsk();
                    }
                  }}
                  placeholder="Sending an email"
                />
                <button type="button" className="btn" disabled={!askText.trim()} onClick={addAsk}>
                  Add
                </button>
              </span>
            </div>

            <div className="nb-field">
              <span className="nb-title" id="nb-wallpaper">Wallpaper</span>
              <span className="swatches" role="radiogroup" aria-labelledby="nb-wallpaper">
                {WALLPAPERS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={wallpaper === w}
                    aria-label={w}
                    title={w}
                    className="swatch"
                    style={{ background: `var(--wall-${w})` }}
                    onClick={() => setWallpaper(w)}
                  >
                    {wallpaper === w && <PixelIcon name="check" size={12} />}
                  </button>
                ))}
              </span>
            </div>
          </div>
        )}

        {error && <p className="form-error nb-error" role="alert">{error}</p>}

        <div className="form-acts">
          {overview.bots.length > 0 && (
            <button
              type="button"
              className="btn ghost left"
              onClick={() => {
                onClose();
                newTeam();
              }}
            >
              Group chat
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Create bot
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function TeamDialog({ team, onClose }: { team: TeamSummary | null; onClose(): void }) {
  const { overview, go } = useCrew();
  const [name, setName] = useState(team?.name ?? "");
  const [picked, setPicked] = useState<string[]>(() => (team ? [team.lead, ...team.members.filter((m) => m !== team.lead)] : []));
  const [chosenLead, setLead] = useState(team?.lead ?? "");
  const [purpose, setPurpose] = useState(team?.purpose ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const bots = overview.bots;
  const lead = picked.includes(chosenLead) ? chosenLead : (picked[0] ?? "");

  const submit = async () => {
    if (!name.trim()) return setError("Give the group chat a name.");
    if (!lead) return setError("Pick at least one bot.");
    setBusy(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        lead,
        members: picked.filter((m) => m !== lead),
        purpose: purpose.trim(),
      };
      if (team) {
        await invoke("crew:teamUpdate", team.slug, payload);
        onClose();
        go({ name: "team", slug: team.slug });
      } else {
        const { slug } = await invoke("crew:teamCreate", payload);
        onClose();
        go({ name: "team", slug });
      }
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title={team ? `Edit ${team.name}` : "New group chat"} onClose={onClose} width={560}>
      <form
        className="nb-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="nb-field">
          <label className="nb-title" htmlFor="tm-name">Name</label>
          <input
            id="tm-name"
            className="field"
            value={name}
            maxLength={LIMITS.name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Weekly report"
            data-autofocus
          />
        </div>

        <div className="nb-field">
          <label className="nb-title" htmlFor="tm-purpose">Purpose</label>
          <input
            id="tm-purpose"
            className="field"
            value={purpose}
            maxLength={LIMITS.job}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Research a topic and write it up"
          />
        </div>

        <div className="nb-field">
          <span className="nb-title" id="tm-bots">Bots</span>
          <div className="team-members-picker" role="group" aria-labelledby="tm-bots">
            {bots.map((b) => (
              <label key={b.slug} className="check-row team-member-row">
                <input className="pcheck" type="checkbox" checked={picked.includes(b.slug)} onChange={(e) => setPicked(e.target.checked ? [...picked, b.slug] : picked.filter((m) => m !== b.slug))} />
                <Face avatar={b.avatar} color={b.color} mood={b.mood} size={24} />
                <span className="ell">{b.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="nb-field">
          <label className="nb-title" htmlFor="tm-lead">Answers first</label>
          <select id="tm-lead" className="field" value={lead} disabled={!picked.length} onChange={(e) => setLead(e.target.value)}>
            {picked.map((slug) => (
              <option key={slug} value={slug}>
                {bots.find((b) => b.slug === slug)?.name ?? slug}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="form-error nb-error" role="alert">{error}</p>}

        <div className="form-acts">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Saving…" : team ? "Save" : "Create group chat"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
