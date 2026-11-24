// Settings, Phone: pair a phone with a QR code, list the phones that are paired and remove them.
// The main process owns the state; this page shows the view it sends.

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { toast } from "@opendeck/shell";
import { errorText, invoke, on } from "../shared/api.ts";
import type { PhoneView, PhonesView } from "../shared/contract.ts";
import { Row } from "./SettingsRow.tsx";

type Pairing = NonNullable<PhonesView["pairing"]>;

const RELAY_WORDS: Record<PhonesView["relay"], string> = {
  online: "Connected",
  connecting: "Connecting…",
  waiting: "Reconnecting…",
  stopped: "Off until a phone is connected",
};

const QUIET_ZONE = 4;

/** The QR code as one path: a square for each dark module, inside a quiet zone of four modules. */
function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { size: n + QUIET_ZONE * 2, d };
}

const secondsLeft = (expiresAt: string, now: number) => Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const seen = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function phoneSub(phone: PhoneView): string {
  const when = phone.online ? "Online now" : phone.lastSeen ? `Last seen ${seen(phone.lastSeen)}` : "Never connected";
  return phone.notifications ? when : `${when} · Notifications off`;
}

const copyCode = (code: string) => navigator.clipboard.writeText(code).then(() => toast("Code copied"), (e) => toast(errorText(e)));

function PairingPanel({ pairing, busy, onNewCode, onCancel }: { pairing: Pairing; busy: boolean; onNewCode(): void; onCancel(): void }) {
  const [now, setNow] = useState(() => Date.now());
  const { code, connected, expiresAt } = pairing;
  const qr = useMemo(() => (code === null ? null : qrPath(code)), [code]);

  useEffect(() => {
    if (connected !== null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [connected]);

  if (connected !== null) {
    return (
      <section className="phone-pair px-frame" role="group" aria-label="Connect a phone">
        <p className="settings-name" aria-live="polite">
          Connected: {connected}
        </p>
        <div className="phone-acts">
          <button type="button" className="btn primary" onClick={onCancel}>
            Done
          </button>
        </div>
      </section>
    );
  }

  const left = secondsLeft(expiresAt, now);
  if (left === 0) {
    return (
      <section className="phone-pair px-frame" role="group" aria-label="Connect a phone">
        <p className="settings-sub" aria-live="polite">
          This code expired.
        </p>
        <div className="phone-acts">
          <button type="button" className="btn primary" disabled={busy} onClick={onNewCode}>
            New code
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="phone-pair px-frame" role="group" aria-label="Connect a phone">
      {code !== null && qr !== null && (
        <>
          <svg className="phone-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} width={220} height={220} shapeRendering="crispEdges" role="img" aria-label="Pairing code as a QR code">
            <path d={qr.d} />
          </svg>
          <p className="settings-sub">Scan this with Fenna Crew on your phone.</p>
          <div className="phone-code-row">
            <span className="phone-code ell" title={code}>
              {code}
            </span>
            <button type="button" className="btn" onClick={() => void copyCode(code)}>
              Copy code
            </button>
          </div>
        </>
      )}
      <span className="phone-countdown" aria-live="off">
        Expires in {clock(left)}
      </span>
      <p className="settings-sub">Waiting for your phone…</p>
      <div className="phone-acts">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

export function PhoneSection() {
  const [view, setView] = useState<PhonesView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const off = on("crew:phones", (v) => {
      if (alive) setView(v);
    });
    invoke("crew:phones").then(
      (v) => {
        if (alive) setView(v);
      },
      (e) => {
        if (alive) setLoadError(errorText(e));
      },
    );
    return () => {
      alive = false;
      off();
    };
  }, []);

  const pair = async () => {
    setBusy(true);
    try {
      await invoke("crew:phonePair");
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    try {
      setView(await invoke("crew:phonePairCancel"));
    } catch (e) {
      toast(errorText(e));
    }
  };

  const remove = async (phone: PhoneView) => {
    setArmed(null);
    try {
      setView(await invoke("crew:phoneRemove", phone.id));
    } catch (e) {
      toast(errorText(e));
    }
  };

  if (loadError) return <p className="hint">{loadError}</p>;
  if (!view) return <p className="hint">Loading…</p>;

  return (
    <>
      <Row name="Your phone" sub={view.problem ?? "Use your crew from your phone while this computer is on and Crew is open."}>
        {view.problem === null && (
          <button type="button" className="btn primary" disabled={busy || !!view.pairing} onClick={() => void pair()}>
            Connect a phone
          </button>
        )}
      </Row>

      {view.pairing && <PairingPanel pairing={view.pairing} busy={busy} onNewCode={() => void pair()} onCancel={() => void cancel()} />}

      {view.phones.length === 0 && !view.pairing && <p className="hint">No phone is connected.</p>}
      {view.phones.map((phone) => (
        <Row key={phone.id} name={phone.name} sub={phoneSub(phone)}>
          {armed === phone.id ? (
            <div className="phone-acts">
              <button type="button" className="btn danger" onClick={() => void remove(phone)}>
                Remove {phone.name}
              </button>
              <button type="button" className="btn" onClick={() => setArmed(null)}>
                Keep
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => setArmed(phone.id)}>
              Remove
            </button>
          )}
        </Row>
      ))}

      <Row name="Relay" sub={`${view.relayUrl} · ${RELAY_WORDS[view.relay]}`} />
    </>
  );
}
