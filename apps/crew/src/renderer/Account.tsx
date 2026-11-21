// A bot's own Google account, in its Details: the vault login it is signed
// in with, and what the bot's browser is signed in as. Crew signs the browser
// in from the vault; this section only shows the state (as the last check
// saw it) and the buttons for it. Never a password.
import { useEffect, useState } from "react";
import { MenuButton, toast, type MenuEntry } from "@opendeck/shell";
import { errorText, invoke, on } from "../shared/api.ts";
import type { AccountState, AccountView, BotSummary } from "../shared/contract.ts";
import { PixelIcon } from "./PixelIcon.tsx";
import { useCrew, useVault } from "./crew.tsx";
import { when } from "./util.ts";

const GOOGLE_ORIGIN = "https://accounts.google.com";

type Action = "check" | "sign_in" | "sign_out";

/** The state line: what the last check saw. */
function stateLine(view: AccountView | null): string {
  if (!view) return "Not checked yet";
  switch (view.state) {
    case "missing":
      return "Not in the vault on this computer";
    case "unknown":
      return "Not checked yet";
    case "signed_out":
      return "Signed out";
    case "signing_in":
      return "Signing in";
    case "signed_in":
      return "Signed in";
    case "other_account":
      return view.signedInAs ? `Signed in as ${view.signedInAs} instead` : "Signed in as someone else";
    case "needs_you":
      return view.message;
  }
}

const NEEDS_YOU: AccountState[] = ["missing", "needs_you"];

/** The bot's Google account: pick a vault login, and see and change its sign-in. */
export function AccountSection({ bot, account, save }: { bot: BotSummary; account: string | null; save(next: string | null): void }) {
  const { items } = useVault();
  const { go } = useCrew();
  const [view, setView] = useState<AccountView | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);

  useEffect(() => {
    if (!account) return;
    let live = true;
    void invoke("crew:accounts").then(
      (list) => live && setView(list.find((v) => v.slug === bot.slug && v.login === account) ?? null),
      () => undefined,
    );
    const off = on("crew:account", (p) => {
      if (p.slug === bot.slug && p.account?.login === account) setView(p.account);
    });
    return () => {
      live = false;
      off();
    };
  }, [bot.slug, account]);

  if (!account) {
    const logins = (items ?? []).filter((i) => i.origins.includes(GOOGLE_ORIGIN));
    const entries: MenuEntry[] = [
      ...logins.map((i) => ({ label: i.label, aside: i.username, onSelect: () => save(i.name) })),
      ...(logins.length ? ["separator" as const] : []),
      { label: "Add one in the vault", onSelect: () => go({ name: "vault" }) },
    ];
    return (
      <>
        <p className="hint">A Google account of its own lets {bot.name} join Meet calls and use Gmail, Calendar and Drive as itself.</p>
        <span className="inline">
          {logins.length === 1 ? (
            <button type="button" className="btn primary" onClick={() => save(logins[0]!.name)}>
              Use {logins[0]!.username || logins[0]!.label}
            </button>
          ) : logins.length ? (
            <MenuButton className="btn" label="Choose an account" entries={entries}>
              Choose an account
            </MenuButton>
          ) : (
            <button type="button" className="btn" onClick={() => go({ name: "vault" })}>
              Add one in the vault
            </button>
          )}
        </span>
      </>
    );
  }

  const current = view && view.login === account ? view : null;
  const state: AccountState = current?.state ?? "unknown";
  const name = current?.email || account;
  const run = (action: Action) => {
    setBusy(action);
    invoke("crew:account", bot.slug, action).then(
      (v) => setView(v),
      (e) => toast(errorText(e)),
    ).finally(() => setBusy(null));
  };
  const check = { label: "Check", onClick: () => run("check") };
  const signIn = { label: "Sign in", onClick: () => run("sign_in") };
  const signOut = { label: "Sign out", onClick: () => run("sign_out") };
  const computer = { label: "Open computer", onClick: () => go({ name: "computer", slug: bot.slug }) };
  const buttons: { label: string; onClick(): void }[] = {
    missing: [],
    unknown: [check],
    signed_out: [signIn],
    signing_in: [],
    signed_in: [check, signOut],
    other_account: [signOut],
    needs_you: [computer, check],
  }[state];

  return (
    <ul className="grants">
      <li className="grant login-grant">
        <div className="grant-head">
          <span className="row-text">
            <span className="grant-name ell" title={name}>
              {name}
            </span>
            <span className={`row-sub ell${NEEDS_YOU.includes(state) ? " need" : ""}`} title={current?.checkedAt ? `Checked ${when(current.checkedAt)}` : undefined}>
              {stateLine(current)}
            </span>
          </span>
          {buttons.map((b) => (
            <button key={b.label} type="button" className="btn small" disabled={busy !== null} onClick={b.onClick}>
              {b.label}
            </button>
          ))}
          <button type="button" className="icon-btn" aria-label={`Stop using ${name} for ${bot.name}`} title={`Stop using ${name} for ${bot.name}`} onClick={() => save(null)}>
            <PixelIcon name="close" size={12} />
          </button>
        </div>
      </li>
    </ul>
  );
}
