// What the chat knows about each assistant on this computer, and getting
// one ready: install (the app's own copy, from the maker), sign in (the
// browser opens; a code can be pasted back), the account it uses. After
// Arsaze's local-agent controls.

import { useCallback, useEffect, useState } from "react";
import { type AgentCatalog, type AgentKind, AGENT_KINDS, agent } from "./agents.ts";

export type SetupStep =
  | { step: "ready" }
  | { step: "loading"; kind: AgentKind }
  | { step: "install"; kind: AgentKind }
  | { step: "sign-in"; kind: AgentKind; api?: boolean; expired?: boolean };

export interface SignInState {
  kind: AgentKind;
  state: "waiting" | "done" | "failed";
  url: string | null;
  needsCode: boolean;
}

/** Where `kind` stands: what the user has to do before it can answer. */
export function setupOf(kind: AgentKind | null, catalog: AgentCatalog | undefined, expired: boolean): SetupStep {
  if (!kind) return { step: "ready" };
  if (!catalog) return { step: "loading", kind };
  if (!catalog.installed) return { step: "install", kind };
  if (catalog.signedIn === false) return { step: "sign-in", kind };
  if (catalog.apiKey) return { step: "sign-in", kind, api: true };
  if (expired) return { step: "sign-in", kind, expired: true };
  return { step: "ready" };
}

export type Agents = ReturnType<typeof useAgents>;

export function useAgents() {
  const [catalogs, setCatalogs] = useState<Partial<Record<AgentKind, AgentCatalog>>>({});
  const [installing, setInstalling] = useState<AgentKind | null>(null);
  const [installLine, setInstallLine] = useState("");
  const [signin, setSignin] = useState<SignInState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState<Partial<Record<AgentKind, true>>>({});

  const put = useCallback((c: AgentCatalog) => setCatalogs((all) => ({ ...all, [c.kind]: c })), []);
  const load = useCallback(
    (kind: AgentKind, fresh = false) =>
      agent.catalog(kind, fresh).then(put, () => undefined),
    [put],
  );

  useEffect(() => {
    for (const k of AGENT_KINDS) void load(k);
  }, [load]);

  useEffect(
    () =>
      agent.onSetup((ev) => {
        if (ev.type === "install") return setInstallLine(ev.line);
        setSignin({ kind: ev.kind, state: ev.state, url: ev.url ?? null, needsCode: !!ev.needsCode });
        if (ev.catalog) put(ev.catalog);
        if (ev.state === "done") {
          setExpired((x) => {
            const next = { ...x };
            delete next[ev.kind];
            return next;
          });
          setSignin(null);
        }
      }),
    [put],
  );

  const guarded = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  };

  return {
    catalogs,
    installing,
    installLine,
    signin,
    error,
    load,
    stepOf: (kind: AgentKind | null) => setupOf(kind, kind ? catalogs[kind] : undefined, !!(kind && expired[kind])),
    install: (kind: AgentKind) =>
      guarded(async () => {
        setInstalling(kind);
        setInstallLine("");
        try {
          put(await agent.install(kind));
        } finally {
          setInstalling(null);
        }
      }),
    signIn: (kind: AgentKind) => guarded(() => agent.signIn(kind)),
    submitCode: (code: string) => (signin ? agent.signInCode(signin.kind, code) : Promise.resolve(false)),
    cancelSignIn: () => {
      if (signin) void agent.signInCancel(signin.kind);
      setSignin(null);
    },
    signOut: (kind: AgentKind) => guarded(async () => put(await agent.signOut(kind))),
    setAccountMode: (kind: AgentKind, mode: "computer" | "own") => guarded(async () => put(await agent.setAccountMode(kind, mode))),
    /** The CLI said its sign-in no longer works: ask again before the next message. */
    markExpired: (kind: AgentKind) => setExpired((x) => ({ ...x, [kind]: true })),
  };
}
