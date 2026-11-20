import "@opendeck/shell/base.css";
import "./styles.css";
import "./pixel.css";
import "./px/chat.css";
import "./px/dialogs.css";
import "./px/pages.css";
import "./px/computer.css";
import "./px/overview.css";
import "./px/apps.css";
import "./px/processes.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installTooltips } from "@opendeck/shell";
import { App } from "./App.tsx";

installTooltips();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
