import { createRoot } from "react-dom/client";
import { installTooltips } from "@opendeck/shell";
import { App } from "./App.tsx";
import "@opendeck/shell/base.css";
import "./styles.css";

installTooltips();
createRoot(document.getElementById("root")!).render(<App />);
