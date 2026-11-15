import "@opendeck/shell/base.css";
import "./styles.css";
import "./panels/inspector.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toast, installTooltips } from "@opendeck/shell";
import { App } from "./App.tsx";

installTooltips();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toast />
  </StrictMode>
);

