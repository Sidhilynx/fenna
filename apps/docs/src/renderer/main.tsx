import { createRoot } from "react-dom/client";
import { installTooltips } from "@opendeck/shell";
import { App } from "./App.tsx";
import { PrintView } from "./PrintView.tsx";
import "@opendeck/shell/base.css";
import "./styles.css";

// A hidden export window loads the same page with #print.
const printing = /(^#|&)print(&|$)/.test(location.hash);
if (!printing) installTooltips();
createRoot(document.getElementById("root")!).render(printing ? <PrintView /> : <App />);
