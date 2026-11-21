// The Repos part of a bot's Details: the git repos it works on in Files/Repos,
// linked from a folder on this computer or cloned from a URL. Each one shows its
// branch and changes, its team and what the crew shipped from it, and the policy
// the GitHub loop follows for it. The rules and text are in reposModel.ts.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { errorText, invoke, on } from "../shared/api.ts";
import type { BotSummary, RepoInfo, RepoPolicy, ReposView, ShippedEntry, TeamMember } from "../shared/contract.ts";
import { useCrew } from "./crew.tsx";
import { canSync, isHttpsUrl, isUncommittedError, repoLine, shortDate, shortPath, shortUrl, teamLine } from "./reposModel.ts";

/** A failed change to one repo, shown under it. canForce: the repo has uncommitted changes. */
interface RowError {
  name: string;
  text: string;
  canForce: boolean;
}

/** The bot's repos, kept live: reloaded on every change that can alter them. */
function useRepos(slug: string) {
  const [view, setView] = useState<ReposView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke("crew:repos", slug).then(
        (next) => {
          if (!alive) return;
          setView(next);
          setError("");
        },
        (e) => alive && setError(errorText(e)),
      );
    void load();
    // The bot's own commits show up as disk and overview changes, which come in bursts during a run: one reload per burst.
    let timer = 0;
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => alive && void load(), 600);
    };
    const offs = [
      on("crew:repos", (p) => {
        if (alive && p.slug === slug) void load();
      }),
      on("crew:disk", (p) => {
        if (p.slug === slug) soon();
      }),
      on("crew:changed", soon),
    ];
    return () => {
      alive = false;
      window.clearTimeout(timer);
      offs.forEach((off) => off());
    };
  }, [slug]);
  return { view, error, setView };
}

/** The team on a repo and the latest three things shipped from it. Reloaded when its last commit or remote changes. */
function useRepoFacts(key: string, stamp: string) {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [shipped, setShipped] = useState<ShippedEntry[]>([]);
  useEffect(() => {
    let alive = true;
    void Promise.all([invoke("crew:repoTeam", key), invoke("crew:shipped", key)]).then(
      ([members, entries]) => {
        if (!alive) return;
        setTeam(members);
        setShipped(entries.slice(0, 3));
      },
      () => {
        if (alive) {
          setTeam([]);
          setShipped([]);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [key, stamp]);
  return { team, shipped };
}

function Toggle({ id, label, checked, disabled, onChange }: { id: string; label: string; checked: boolean; disabled: boolean; onChange(on: boolean): void }) {
  return (
    <div className="proj-toggle">
      <label htmlFor={id} className="proj-toggle-name">
        {label}
      </label>
      <input id={id} className="px-switch" type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

interface RepoRowProps {
  slug: string;
  index: number;
  repo: RepoInfo;
  busy: boolean;
  armed: boolean;
  error: RowError | null;
  onSync(): void;
  onRemove(): void;
  onForce(): void;
  onPolicy(policy: Partial<RepoPolicy>): void;
}

function RepoRow({ slug, index, repo, busy, armed, error, onSync, onRemove, onForce, onPolicy }: RepoRowProps) {
  const { go } = useCrew();
  const { team, shipped } = useRepoFacts(repo.key, `${repo.last?.hash ?? ""}|${repo.origin ?? ""}`);
  const id = `repo-${index}`;
  const members = teamLine(team);

  return (
    <li className="proj-row repo-row">
      <span className="repo-name ell" title={repo.name}>
        {repo.name}
      </span>
      <p className="hint ell" title={repoLine(repo)}>
        {repoLine(repo)}
      </p>
      {repo.source && (
        <p className="hint ell" title={repo.source}>
          {`From ${shortPath(repo.source)}`}
        </p>
      )}
      {repo.origin && (
        <p className="hint ell" title={repo.origin}>
          {`Remote ${shortUrl(repo.origin)}`}
        </p>
      )}
      {members && (
        <p className="hint ell" title={members}>
          {members}
        </p>
      )}
      {shipped.length > 0 && (
        <ul className="repo-ships">
          {shipped.map((s, n) => (
            <li key={`${s.at}-${n}`} className="repo-ship">
              <span className="repo-ship-kind">{s.kind}</span>
              {isHttpsUrl(s.url) ? (
                <button type="button" className="repo-link ell" title={s.url} onClick={() => window.open(s.url, "_blank", "noopener")}>
                  {s.title}
                </button>
              ) : (
                <span className="ell" title={s.title}>
                  {s.title}
                </span>
              )}
              <span className="repo-ship-date">{shortDate(s.at)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="dsec-acts">
        <button type="button" className="btn small" onClick={() => go({ name: "computer", slug, launch: { app: "code", props: { root: repo.path } } })}>
          Open in Code
        </button>
        {canSync(repo) && (
          <button type="button" className="btn small" disabled={busy} onClick={onSync}>
            Sync
          </button>
        )}
        <button type="button" className="btn small danger" disabled={busy} onClick={onRemove}>
          {armed ? "Remove, sure?" : "Remove"}
        </button>
        {error?.canForce && (
          <button type="button" className="btn small danger" disabled={busy} onClick={onForce}>
            Remove with changes
          </button>
        )}
      </div>
      {error && (
        <p className="hint repo-error" role="alert">
          {error.text}
        </p>
      )}

      {repo.origin && (
        <>
          <Toggle id={`${id}-comment`} label="Comment on GitHub without asking" checked={repo.policy.comment === "auto"} disabled={busy} onChange={(on) => onPolicy({ comment: on ? "auto" : "ask" })} />
          <Toggle id={`${id}-draft`} label="Draft pull requests only" checked={repo.policy.draftOnly} disabled={busy} onChange={(on) => onPolicy({ draftOnly: on })} />
          <Toggle id={`${id}-merge`} label="Never merge" checked={repo.policy.merge === "never"} disabled={busy} onChange={(on) => onPolicy({ merge: on ? "never" : "ask" })} />
        </>
      )}
    </li>
  );
}

export function ReposSection({ bot }: { bot: BotSummary }) {
  const { view, error: loadError, setView } = useRepos(bot.slug);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState("");
  const [rowError, setRowError] = useState<RowError | null>(null);
  const [armed, setArmed] = useState("");
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // "Remove, sure?" waits four seconds for the second click, then goes back to "Remove".
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(""), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  /** Runs one change; its view replaces the list. A failure goes to onError and the list stays as it was. */
  async function run(call: () => Promise<ReposView>, onError: (text: string) => void) {
    setBusy(true);
    try {
      const next = await call();
      if (alive.current) setView(next);
      return true;
    } catch (e) {
      if (alive.current) onError(errorText(e));
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const link = () => {
    setFormError("");
    void run(() => invoke("crew:repoLink", bot.slug), setFormError);
  };

  const clone = async (e: FormEvent) => {
    e.preventDefault();
    const address = url.trim();
    if (!address) return;
    setFormError("");
    if (await run(() => invoke("crew:repoClone", bot.slug, address), setFormError)) setUrl("");
  };

  const setShell = (on: boolean) => {
    setFormError("");
    void run(() => invoke("crew:repoShell", bot.slug, on), setFormError);
  };

  const setPolicy = (repo: RepoInfo, policy: Partial<RepoPolicy>) => {
    setFormError("");
    void run(() => invoke("crew:repoPolicy", bot.slug, repo.name, policy), setFormError);
  };

  const sync = (repo: RepoInfo) => {
    setRowError(null);
    void run(() => invoke("crew:repoSync", bot.slug, repo.name), (text) => setRowError({ name: repo.name, text, canForce: false }));
  };

  const remove = (repo: RepoInfo, force: boolean) => {
    setArmed("");
    setRowError(null);
    void run(
      () => invoke("crew:repoRemove", bot.slug, repo.name, force),
      (text) => setRowError({ name: repo.name, text, canForce: !force && isUncommittedError(text) }),
    );
  };

  const removeClick = (repo: RepoInfo) => {
    if (armed !== repo.name) {
      setArmed(repo.name);
      return;
    }
    remove(repo, false);
  };

  return (
    <>
      <div className="dsec-acts">
        <button type="button" className="btn small" disabled={busy} onClick={link}>
          Link a folder
        </button>
      </div>
      <form className="repo-clone" onSubmit={(e) => void clone(e)}>
        <label htmlFor="repo-url" className="sr">
          Repo address
        </label>
        <input id="repo-url" className="field" type="text" placeholder="https://github.com/owner/repo" value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} />
        <button type="submit" className="btn small" disabled={busy || !url.trim()}>
          Clone
        </button>
      </form>
      {formError && (
        <p className="hint repo-error" role="alert">
          {formError}
        </p>
      )}

      {!view ? (
        <p className="hint">{loadError || "Loading"}</p>
      ) : (
        <>
          {view.shellNeeded && (
            <>
              <Toggle id="repo-shell" label="Run its own commands" checked={view.shell} disabled={busy} onChange={setShell} />
              <p className="hint">Its AI can't sandbox commands on this computer. When on, commands run as you.</p>
            </>
          )}
          {view.repos.length === 0 ? (
            <p className="hint">{`No repos yet. Link a folder or clone a URL, and ${bot.name} works on its own copy in Files/Repos.`}</p>
          ) : (
            <ul className="proj-list">
              {view.repos.map((repo, i) => (
                <RepoRow
                  key={repo.name}
                  slug={bot.slug}
                  index={i}
                  repo={repo}
                  busy={busy}
                  armed={armed === repo.name}
                  error={rowError?.name === repo.name ? rowError : null}
                  onSync={() => sync(repo)}
                  onRemove={() => removeClick(repo)}
                  onForce={() => remove(repo, true)}
                  onPolicy={(policy) => setPolicy(repo, policy)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
