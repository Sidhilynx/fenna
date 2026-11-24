// Vendor logos from simple-icons (CC0), and Arsaze's own mark, as markup. Each
// vendor logo carries its brand colour; a colour that would vanish against the
// page in one theme (near-black on dark, near-white on light) is shown in the
// text color there instead. See assets/connectors/LICENSE.md.

import airtable from "./assets/connectors/airtable.svg?raw";
import arsaze from "./assets/connectors/arsaze.svg?raw";
import asana from "./assets/connectors/asana.svg?raw";
import atlassian from "./assets/connectors/atlassian.svg?raw";
import braveSearch from "./assets/connectors/brave-search.svg?raw";
import chromeDevtools from "./assets/connectors/chrome-devtools.svg?raw";
import cloudflare from "./assets/connectors/cloudflare.svg?raw";
import dropbox from "./assets/connectors/dropbox.svg?raw";
import figma from "./assets/connectors/figma.svg?raw";
import github from "./assets/connectors/github.svg?raw";
import gitlab from "./assets/connectors/gitlab.svg?raw";
import huggingface from "./assets/connectors/huggingface.svg?raw";
import intercom from "./assets/connectors/intercom.svg?raw";
import linear from "./assets/connectors/linear.svg?raw";
import mongodb from "./assets/connectors/mongodb.svg?raw";
import neon from "./assets/connectors/neon.svg?raw";
import notion from "./assets/connectors/notion.svg?raw";
import pagerduty from "./assets/connectors/pagerduty.svg?raw";
import paypal from "./assets/connectors/paypal.svg?raw";
import sentry from "./assets/connectors/sentry.svg?raw";
import square from "./assets/connectors/square.svg?raw";
import stripe from "./assets/connectors/stripe.svg?raw";
import supabase from "./assets/connectors/supabase.svg?raw";
import todoist from "./assets/connectors/todoist.svg?raw";
import vercel from "./assets/connectors/vercel.svg?raw";
import webflow from "./assets/connectors/webflow.svg?raw";
import zapier from "./assets/connectors/zapier.svg?raw";

export interface ConnectorLogo {
  svg: string;
  /** The brand colour from simple-icons. Absent: the text color. */
  color?: string;
  /** The theme whose background the colour would vanish against; there the text color is used. */
  clash?: "dark" | "light";
}

export const CONNECTOR_LOGOS: Record<string, ConnectorLogo> = {
  airtable: { svg: airtable, color: "#18BFFF" },
  arsaze: { svg: arsaze },
  asana: { svg: asana, color: "#F06A6A" },
  atlassian: { svg: atlassian, color: "#0052CC" },
  "brave-search": { svg: braveSearch, color: "#FB542B" },
  "chrome-devtools": { svg: chromeDevtools, color: "#4285F4" },
  cloudflare: { svg: cloudflare, color: "#F38020" },
  dropbox: { svg: dropbox, color: "#0061FF" },
  figma: { svg: figma, color: "#F24E1E" },
  github: { svg: github, color: "#181717", clash: "dark" },
  gitlab: { svg: gitlab, color: "#FC6D26" },
  huggingface: { svg: huggingface, color: "#FFD21E", clash: "light" },
  intercom: { svg: intercom, color: "#6AFDEF", clash: "light" },
  linear: { svg: linear, color: "#5E6AD2" },
  mongodb: { svg: mongodb, color: "#47A248" },
  neon: { svg: neon, color: "#34D59A" },
  notion: { svg: notion, color: "#000000", clash: "dark" },
  pagerduty: { svg: pagerduty, color: "#06AC38" },
  paypal: { svg: paypal, color: "#002991", clash: "dark" },
  sentry: { svg: sentry, color: "#362D59", clash: "dark" },
  square: { svg: square, color: "#3E4348" },
  stripe: { svg: stripe, color: "#635BFF" },
  supabase: { svg: supabase, color: "#3FCF8E" },
  todoist: { svg: todoist, color: "#E44332" },
  vercel: { svg: vercel, color: "#000000", clash: "dark" },
  webflow: { svg: webflow, color: "#146EF5" },
  zapier: { svg: zapier, color: "#FF4F00" },
};
