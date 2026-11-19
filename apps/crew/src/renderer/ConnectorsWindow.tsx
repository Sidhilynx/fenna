// A bot's connectors, in its computer: the built-in Fenna apps it may use
// (on or off), the connectors it is given (Grants.tsx), and a way to the
// Connectors page to install more. The window frame owns the title bar.
import { FENNA_APPS, type Connector, type FennaAppId } from "@opendeck/crew";
import { toast } from "@opendeck/shell";
import { errorText, invoke } from "../shared/api.ts";
import type { BotSummary } from "../shared/contract.ts";
import { fennaAppIcon } from "./appIcons.ts";
import { Grants } from "./Grants.tsx";
import { PixelCheck } from "./PixelCheck.tsx";
import { useBotDetail, useCrew } from "./crew.tsx";

export function ConnectorsWindow({ bot }: { bot: BotSummary }) {
  const { go } = useCrew();
  const { detail, setDetail, error } = useBotDetail(bot);
  const connectors: Connector[] = detail?.bot?.connectors ?? [];

  const saveConnectors = (next: Connector[]) => {
    invoke("crew:update", bot.slug, { connectors: next }).then(setDetail).catch((e) => toast(errorText(e)));
  };
  const setApp = (id: FennaAppId, on: boolean) =>
    saveConnectors(on ? [...connectors, { type: "fenna" as const, app: id }] : connectors.filter((c) => !(c.type === "fenna" && c.app === id)));

  return (
    <div className="connectors-body">
      {!detail ? (
        <p className="hint">{error || "Loading"}</p>
      ) : (
        <>
          <section className="connectors-section" aria-label="Built in">
            <h2 className="section-title">Built in</h2>
            <ul className="connectors-apps">
              {FENNA_APPS.map((a) => (
                <li key={a.id} className="connectors-app">
                  <img className="connectors-app-icon" src={fennaAppIcon(a.id)} alt="" />
                  <PixelCheck checked={connectors.some((c) => c.type === "fenna" && c.app === a.id)} onChange={(on) => setApp(a.id, on)} label={a.name} />
                </li>
              ))}
            </ul>
          </section>

          <section className="connectors-section" aria-label="Connected">
            <h2 className="section-title">Connected</h2>
            <Grants botName={bot.name} connectors={connectors} save={saveConnectors} />
          </section>

          <div>
            <button type="button" className="btn" onClick={() => go({ name: "connectors" })}>
              Browse connectors
            </button>
          </div>
        </>
      )}
    </div>
  );
}
