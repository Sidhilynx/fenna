// The first screen: connect this phone to Crew on a computer by scanning the
// code Crew shows (Settings, Phone), or by typing or pasting it.

import { useState } from "react";
import { CapacitorBarcodeScanner, CapacitorBarcodeScannerScanOrientation, CapacitorBarcodeScannerTypeHint } from "@capacitor/barcode-scanner";
import { errorText } from "../../../crew/src/shared/api.ts";
import { CrewMark } from "../../../crew/src/renderer/Avatar.tsx";
import { link, native } from "../bridge.ts";
import { useStore } from "../state.tsx";
import { haptic, Sheet, Working } from "../ui.tsx";

export function Pair() {
  const { link: state } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");

  async function connect(text: string) {
    setBusy(true);
    setError(null);
    try {
      await link.pair(text);
      haptic("ok");
    } catch (e) {
      haptic("fail");
      setError(errorText(e));
      setBusy(false);
    }
  }

  async function scan() {
    setError(null);
    try {
      const r = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: "Point at the code in Crew on your computer",
        scanOrientation: CapacitorBarcodeScannerScanOrientation.PORTRAIT,
      });
      if (r.ScanResult) await connect(r.ScanResult);
    } catch (e) {
      const text = errorText(e);
      // Closing the camera isn't a failure.
      if (!/cancel/i.test(text)) setError(/permission|denied/i.test(text) ? "Crew needs the camera to scan the code. Allow it in Android's settings, or enter the code instead." : text);
    }
  }

  return (
    <div className="m-body pair">
      <div className="pair-top">
        <CrewMark size={64} />
        <h1 className="pair-title">Connect to your computer</h1>
        <p className="pair-lead">Use your crew from here while your computer is on and Crew is open.</p>
      </div>

      <ol className="pair-steps">
        <li>On your computer, open Crew, then Settings, then Phone.</li>
        <li>Choose Connect a phone.</li>
        <li>Scan the code it shows.</li>
      </ol>

      {state.problem && !error && (
        <p className="pair-note" role="status">
          {state.problem}
        </p>
      )}
      {error && (
        <p className="pair-error" role="alert">
          {error}
        </p>
      )}

      <div className="pair-acts">
        {busy ? (
          <div className="pair-busy">
            <Working label="Connecting" />
            <span>Connecting to {state.computerName || "your computer"}…</span>
          </div>
        ) : (
          <>
            {native && (
              <button type="button" className="btn primary block" onClick={() => void scan()}>
                Scan the code
              </button>
            )}
            <button type="button" className={native ? "btn block" : "btn primary block"} onClick={() => setTyping(true)}>
              Enter the code
            </button>
          </>
        )}
      </div>

      {typing && (
        <Sheet
          title="Enter the code"
          onClose={() => setTyping(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setTyping(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!code.trim()}
                onClick={() => {
                  setTyping(false);
                  void connect(code);
                }}
              >
                Connect
              </button>
            </>
          }
        >
          <label className="m-field">
            <span className="m-label">The code under the QR code on your computer</span>
            <textarea className="field pair-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="fenna1.…" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <span className="m-help">Copy it on your computer and send it to yourself, or type it. Spaces don't matter.</span>
          </label>
        </Sheet>
      )}
    </div>
  );
}
