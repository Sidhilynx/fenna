import "@opendeck/shell/base.css";
import "../../crew/src/renderer/tokens.css";
import "../../crew/src/renderer/faces.css";
import "../../crew/src/renderer/pixel.css";
import "./mobile.css";
import "./screens/screens.css";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { startBridge } from "./bridge.ts";
import { StoreProvider } from "./state.tsx";

const root = createRoot(document.getElementById("root") as HTMLElement);
void startBridge().finally(() =>
  root.render(
    <StoreProvider>
      <App />
    </StoreProvider>,
  ),
);
