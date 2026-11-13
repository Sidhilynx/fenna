// Getting the user's own AI ready, inside the chat: who should answer (the
// first time), install it, sign in, and which account it uses. The browser
// opens for sign-in; never a terminal. After Arsaze's local-agent controls.

import { useState } from "react";
import { type AgentKind, AGENTS, AGENT_KINDS, agent } from "./agents.ts";
import { Icon } from "./ui/icons.tsx";
import type { MenuEntry } from "./ui/Menu.tsx";
import type { Agents } from "./useAgents.ts";

export function Logo({ src, invert, size = 14 }: { src: string; invert: boolean; size?: number }) {
  return <img src={src} alt="" width={size} height={size} className={`as-logo${invert ? " invert" : ""}`} draggable={false} />;
}

export function AgentLogo({ kind, size = 14 }: { kind: AgentKind; size?: number }) {
  return <Logo src={AGENTS[kind].logo} invert={AGENTS[kind].invert} size={size} />;
}

/** One word on where each assistant stands, for the pickers. */
export function statusWord(agents: Agents, kind: AgentKind): string {
  const s = agents.stepOf(kind);
  if (s.step === "loading") return "Checking";
  if (s.step === "install") return "Install";
  if (s.step === "sign-in") return "Sign in";
  return "Ready";
}

/** The first time the chat opens: who should answer? One tap picks; it can change any time in the composer. */
export function AgentChoice({ agents, noun, onPick }: { agents: Agents; noun: string; onPick(kind: AgentKind): void }) {
  return (
    <div className="as-choice">
      <p className="as-choice-q">Who should edit with you?</p>
      <p className="as-choice-sub">Your own AI, on this computer and your own plan. It edits this {noun} while you watch. You can switch any time.</p>
      <div className="as-choice-grid">
        {AGENT_KINDS.map((k, i) => (
          <button key={k} type="button" className="as-tile" style={{ animationDelay: `${i * 50}ms` }} onClick={() => onPick(k)}>
            <span className="as-tile-top">
              <AgentLogo kind={k} size={20} />
              <span className="as-tile-name">{AGENTS[k].name}</span>
              <span className="as-tile-state">{agents.stepOf(k).step === "install" ? "Install in one click" : statusWord(agents, k)}</span>
            </span>
            <span className="as-tile-line">
              {AGENTS[k].maker}’s agent. Uses your {AGENTS[k].plan}.
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Above the composer until the chosen assistant can answer. */
export function AgentSetup({ agents, kind }: { agents: Agents; kind: AgentKind }) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const setup = agents.stepOf(kind);
  if (setup.step === "ready") return null;
  const name = AGENTS[kind].name;

  if (setup.step === "loading") {
    return (
      <div className="as-setup row">
        <AgentLogo kind={kind} size={16} />
        <span className="as-setup-body">Checking {name} on this computer</span>
        <span className="as-spin" aria-hidden />
      </div>
    );
  }

  const signin = agents.signin?.kind === kind ? agents.signin : null;
  const installingThis = agents.installing === kind;
  const catalog = agents.catalogs[kind];
  let title: string;
  let body: string;
  let action: { label: string; run: () => void; busy?: boolean } | null;
  if (setup.step === "install") {
    title = `Use your own ${name}`;
    body = `${name} runs on this computer on your ${AGENTS[kind].plan} and edits with this app’s tools only. The app keeps its own copy, downloaded from ${AGENTS[kind].maker}, separate from any ${name} you already have.`;
    action = { label: installingThis ? `Installing ${name}` : `Install ${name}`, run: () => void agents.install(kind), busy: installingThis || !!agents.installing };
  } else if (signin?.state === "waiting") {
    title = `Finish signing in to ${name}`;
    body = signin.needsCode
      ? "Your browser opened to sign in. If it shows a code at the end, paste it here; otherwise this updates by itself."
      : "Your browser opened to sign in. Come back here when you’re done; this updates by itself.";
    action = null;
  } else if (setup.expired) {
    title = `Sign in to ${name} again`;
    body = `Your ${name} sign-in on this computer has expired. Sign in again, then send your message once more.`;
    action = { label: "Sign in again", run: () => void agents.signIn(kind) };
  } else if (setup.api) {
    title = `${name} is signed in with an API key`;
    body = `That bills per use. Sign in with ${AGENTS[kind].signInWith} to use your plan instead.`;
    action = { label: "Sign in", run: () => void agents.signIn(kind) };
  } else {
    title = `Sign in to ${name}`;
    body =
      kind === "codex"
        ? `Sign in with ${AGENTS[kind].signInWith}. This app keeps its own Codex sign-in, so your own Codex setup isn’t touched.`
        : kind === "claude" && catalog?.accountMode === "own"
          ? "Sign in with the Claude account you want this app to use. Your own Claude Code stays as it is."
          : `Sign in with ${AGENTS[kind].signInWith}. Your browser opens; you do it once on this computer.`;
    action = { label: "Sign in", run: () => void agents.signIn(kind) };
  }

  return (
    <div className="as-setup" role="status">
      <div className="as-setup-head">
        <AgentLogo kind={kind} size={16} />
        <p className="as-setup-title">{title}</p>
      </div>
      <p className="as-setup-body">{body}</p>
      {installingThis && agents.installLine && <p className="as-setup-note">{agents.installLine}</p>}
      {signin?.state === "failed" && <p className="as-setup-note">Signing in didn’t finish. Try again.</p>}
      {agents.error && <p className="as-setup-note">{agents.error}</p>}
      {signin?.state === "waiting" && signin.needsCode && (
        <form
          className="as-setup-code"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void agents.submitCode(code.trim()).then(() => setSent(true));
          }}
        >
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the code" aria-label="Sign-in code" />
          <button type="submit" className="as-setup-btn pri" disabled={!code.trim() || sent}>
            {sent ? "Checking" : "Continue"}
          </button>
        </form>
      )}
      <div className="as-setup-acts">
        {action && (
          <button type="button" className="as-setup-btn pri" onClick={action.run} disabled={action.busy}>
            {action.busy && <span className="as-spin" aria-hidden />}
            {action.label}
          </button>
        )}
        {signin?.state === "waiting" && (
          <>
            <span className="as-spin" aria-hidden />
            {signin.url && (
              <button type="button" className="as-setup-btn" onClick={() => void agent.openUrl(signin.url!)}>
                <Icon name="external" size={14} /> Open the sign-in page
              </button>
            )}
            <button type="button" className="as-setup-btn quiet" onClick={agents.cancelSignIn}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The account menu's entries: who it is, which account (Claude Code), refresh, sign out. */
export function accountEntries(agents: Agents, kind: AgentKind): MenuEntry[] {
  const c = agents.catalogs[kind];
  if (!c) return [];
  const who = c.account?.email ?? (kind === "antigravity" ? "The Google account signed in on this computer" : "Signed in");
  const out: MenuEntry[] = [{ heading: `${AGENTS[kind].name}${c.version ? ` ${c.version}` : ""} · ${who}${c.account?.plan ? ` · ${c.account.plan}` : ""}` }];
  if (kind === "claude") {
    out.push(
      { label: "This computer’s account", hint: "The one Claude Code already uses here", checked: c.accountMode === "computer", onSelect: () => void agents.setAccountMode(kind, "computer") },
      { label: "A separate account for this app", hint: "Sign in once; your own Claude Code stays as it is", checked: c.accountMode === "own", onSelect: () => void agents.setAccountMode(kind, "own") },
      "separator",
    );
  }
  out.push({ label: "Refresh models", icon: <Icon name="refresh" size={14} />, onSelect: () => void agents.load(kind, true) });
  if (kind === "codex" || (kind === "claude" && c.accountMode === "own")) out.push({ label: `Sign out of ${AGENTS[kind].name} here`, onSelect: () => void agents.signOut(kind) });
  return out;
}
