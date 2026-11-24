// New bot: one form, as the desktop's New bot dialog. Name and job are needed;
// the rest starts as the desktop does. "Starting points" fill the form from
// the desktop's examples and never make the bot.

import { useEffect, useState } from "react";
import { pickAvatar, LIMITS } from "@opendeck/crew";
import { errorText, invoke } from "../../../crew/src/shared/api.ts";
import { BOT_TEMPLATES, type BotTemplate } from "../../../crew/src/renderer/templates.ts";
import { useStore } from "../state.tsx";
import { ConnBar, Face, Header, haptic, Row, Sheet, Working } from "../ui.tsx";
import { BrainPicker, cliReady, FacePicker, faceName, SchedulePicker, scheduleProblem, useClis, type Brain, type FaceChoice } from "./pickers.tsx";

type Open = "face" | "starts";

export function NewBot() {
  const { link, overview, push, pop } = useStore();
  const { clis, error: clisError } = useClis();
  const settings = overview?.settings;
  const [face, setFace] = useState<FaceChoice>(() => pickAvatar("", overview?.bots ?? []));
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [how, setHow] = useState("");
  const [schedule, setSchedule] = useState("manual");
  const [brain, setBrain] = useState<Brain>(() => ({ cli: settings?.defaultCli || "claude", model: settings?.defaultModel ?? "", effort: settings?.defaultEffort ?? "" }));
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The default CLI, when it can't run a bot here, gives way to one that can.
  useEffect(() => {
    if (!clis) return;
    const current = clis.find((c) => c.kind === brain.cli);
    if (current && cliReady(current)) return;
    const first = clis.find(cliReady);
    if (first) setBrain({ cli: first.kind, model: "", effort: "" });
  }, [clis]);

  const problem = scheduleProblem(schedule);
  const ready = link.ready;
  const canCreate = ready && !busy && name.trim() !== "" && job.trim() !== "" && problem === null;

  function fill(t: BotTemplate) {
    setName(t.name);
    setJob(t.job);
    setHow(t.how);
    setSchedule(t.schedule);
    setError("");
    setOpen(null);
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const { slug } = await invoke("crew:create", {
        name: name.trim(),
        job: job.trim(),
        how: how.trim(),
        schedule: schedule.trim(),
        cli: brain.cli,
        model: brain.model,
        effort: brain.effort,
        avatar: face.avatar,
        color: face.color,
      });
      haptic("ok");
      pop();
      push({ name: "chat", slug });
    } catch (e) {
      haptic("fail");
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Header back title="New bot" />
      <ConnBar />
      <div className="m-body pad">
        <div className="dt-edge">
          <Row title="Starting points" sub="Fill in the form from an example" onClick={() => setOpen("starts")} />
        </div>

        <div className="m-field">
          <span className="m-label">Face</span>
          <button type="button" className="btn dt-pick" onClick={() => setOpen("face")}>
            <Face avatar={face.avatar} color={face.color} size={32} />
            <span className="ell">{faceName(face.avatar, face.color)}</span>
          </button>
        </div>

        <label className="m-field">
          <span className="m-label">Name</span>
          <input className="field" value={name} maxLength={LIMITS.name} placeholder="Research" onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="m-field">
          <span className="m-label">Job</span>
          <input className="field" value={job} maxLength={LIMITS.job} placeholder="Check a page every Monday and write what changed" onChange={(e) => setJob(e.target.value)} />
        </label>

        <label className="m-field">
          <span className="m-label">How it works</span>
          <textarea className="field dt-big" value={how} maxLength={LIMITS.how} placeholder="Steps to take, in your own words" onChange={(e) => setHow(e.target.value)} />
        </label>

        <div className="m-field">
          <span className="m-label">Schedule</span>
          <SchedulePicker value={schedule} onChange={setSchedule} />
        </div>

        <div className="m-field">
          <span className="m-label">Brain</span>
          {clis ? <BrainPicker value={brain} clis={clis} onChange={setBrain} /> : <p className="m-help">{clisError || "Looking for your CLIs…"}</p>}
        </div>
      </div>

      <div className="dt-bar">
        {error && (
          <p className="dt-error" role="alert">
            {error}
          </p>
        )}
        {!ready && <p className="m-help" role="status">Your computer isn't reachable right now, so the bot can't be made yet.</p>}
        <button type="button" className="btn primary block" disabled={!canCreate} onClick={() => void create()}>
          {busy ? <Working label="Creating" /> : "Create bot"}
        </button>
      </div>

      {open === "face" && (
        <Sheet title="Face" onClose={() => setOpen(null)} actions={<button type="button" className="btn primary" onClick={() => setOpen(null)}>Done</button>}>
          <FacePicker value={face} onChange={setFace} />
        </Sheet>
      )}
      {open === "starts" && (
        <Sheet title="Starting points" onClose={() => setOpen(null)}>
          <div className="dt-edge">
            {BOT_TEMPLATES.map((t) => (
              <Row key={t.id} title={t.name} sub={t.job} onClick={() => fill(t)} />
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
