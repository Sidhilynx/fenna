// Connectors the page offers to add in one step. Each entry was checked
// against the vendor's own documentation or the official MCP Registry
// (registry.modelcontextprotocol.io, whose names are tied to the vendor's
// domain). Crew does not check at run time that a vendor is who it says.
// A web address entry signs in through the sign-in flow in Connectors.tsx.

export const CATEGORIES = ["Work", "Dev", "Docs", "Data", "Design", "Payments"] as const;
export type ConnectorCategory = (typeof CATEGORIES)[number];

export interface CatalogEntry {
  /** Also the connector's name once added, and the logo's file name. */
  id: string;
  name: string;
  vendor: string;
  /** One plain line. */
  description: string;
  kind: "url" | "command";
  url?: string;
  command?: string;
  args?: string[];
  /** oauth: the server signs the person in; token: a value must be pasted; none: nothing needed. */
  auth: "oauth" | "token" | "none";
  /** The page that shows the address or package. */
  docs: string;
  category: ConnectorCategory;
  /** Whether assets/connectors/<id>.svg exists; false draws the plug. */
  logo: boolean;
  /** Shown first, with a "Featured" label. */
  featured?: boolean;
}

const registry = (name: string) => `https://registry.modelcontextprotocol.io/v0.1/servers?search=${name}`;

export const CONNECTOR_CATALOG: CatalogEntry[] = [
  { id: "arsaze", name: "Arsaze", vendor: "Sidhilynx", description: "Edit videos: cuts, captions, b-roll and color.", kind: "url", url: "https://api.arsaze.com/mcp", auth: "oauth", docs: "https://arsaze.com/", category: "Design", logo: true, featured: true },
  { id: "notion", name: "Notion", vendor: "Notion", description: "Search, read and edit pages and databases.", kind: "url", url: "https://mcp.notion.com/mcp", auth: "oauth", docs: "https://developers.notion.com/guides/mcp/get-started-with-mcp", category: "Docs", logo: true },
  { id: "linear", name: "Linear", vendor: "Linear", description: "Find and update issues, projects and cycles.", kind: "url", url: "https://mcp.linear.app/mcp", auth: "oauth", docs: "https://linear.app/docs/mcp", category: "Work", logo: true },
  { id: "github", name: "GitHub", vendor: "GitHub", description: "Read repositories, issues and pull requests, and change them.", kind: "url", url: "https://api.githubcopilot.com/mcp/", auth: "oauth", docs: "https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server", category: "Dev", logo: true },
  { id: "atlassian", name: "Jira and Confluence", vendor: "Atlassian", description: "Work with Jira issues and Confluence pages.", kind: "url", url: "https://mcp.atlassian.com/v2/mcp", auth: "oauth", docs: "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/", category: "Work", logo: true },
  { id: "asana", name: "Asana", vendor: "Asana", description: "Read and update tasks and projects.", kind: "url", url: "https://mcp.asana.com/v2/mcp", auth: "oauth", docs: "https://developers.asana.com/docs/using-asanas-mcp-server", category: "Work", logo: true },
  { id: "monday", name: "monday.com", vendor: "monday.com", description: "Read and update boards and items.", kind: "url", url: "https://mcp.monday.com/mcp", auth: "oauth", docs: registry("com.monday"), category: "Work", logo: false },
  { id: "intercom", name: "Intercom", vendor: "Intercom", description: "Look up conversations and contacts.", kind: "url", url: "https://mcp.intercom.com/mcp", auth: "oauth", docs: "https://developers.intercom.com/docs/guides/mcp", category: "Work", logo: true },
  { id: "zapier", name: "Zapier", vendor: "Zapier", description: "Run actions in the apps connected to your Zapier account.", kind: "url", url: "https://mcp.zapier.com/api/v1/connect", auth: "oauth", docs: registry("com.zapier"), category: "Work", logo: true },
  { id: "sentry", name: "Sentry", vendor: "Sentry", description: "Look into errors, issues and releases.", kind: "url", url: "https://mcp.sentry.dev/mcp", auth: "oauth", docs: "https://mcp.sentry.dev/", category: "Dev", logo: true },
  { id: "cloudflare", name: "Cloudflare", vendor: "Cloudflare", description: "Manage Workers, DNS and the rest of the Cloudflare API.", kind: "url", url: "https://mcp.cloudflare.com/mcp", auth: "oauth", docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/", category: "Dev", logo: true },
  { id: "playwright", name: "Playwright", vendor: "Microsoft", description: "Drive a browser on this computer.", kind: "command", command: "npx", args: ["@playwright/mcp@latest"], auth: "none", docs: "https://github.com/microsoft/playwright-mcp", category: "Dev", logo: false },
  { id: "chrome-devtools", name: "Chrome DevTools", vendor: "Google", description: "Inspect and debug pages in a browser on this computer.", kind: "command", command: "npx", args: ["-y", "chrome-devtools-mcp@latest"], auth: "none", docs: "https://github.com/ChromeDevTools/chrome-devtools-mcp", category: "Dev", logo: true },
  { id: "context7", name: "Context7", vendor: "Upstash", description: "Look up current documentation for code libraries.", kind: "url", url: "https://mcp.context7.com/mcp", auth: "none", docs: "https://github.com/upstash/context7", category: "Docs", logo: false },
  { id: "files", name: "Files", vendor: "Model Context Protocol", description: "Read and write files in folders listed in Arguments.", kind: "command", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], auth: "none", docs: "https://github.com/modelcontextprotocol/servers", category: "Docs", logo: false },
  { id: "memory", name: "Memory", vendor: "Model Context Protocol", description: "Keep notes between runs.", kind: "command", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], auth: "none", docs: "https://github.com/modelcontextprotocol/servers", category: "Docs", logo: false },
  { id: "airtable", name: "Airtable", vendor: "Airtable", description: "Read and edit records in your bases.", kind: "url", url: "https://mcp.airtable.com/mcp", auth: "oauth", docs: "https://support.airtable.com/docs/using-the-airtable-mcp-server", category: "Data", logo: true },
  { id: "supabase", name: "Supabase", vendor: "Supabase", description: "Manage projects, tables and queries.", kind: "url", url: "https://mcp.supabase.com/mcp", auth: "oauth", docs: "https://supabase.com/docs/guides/getting-started/mcp", category: "Data", logo: true },
  { id: "neon", name: "Neon", vendor: "Neon", description: "Manage Postgres projects, branches and queries.", kind: "url", url: "https://mcp.neon.tech/mcp", auth: "oauth", docs: "https://neon.com/docs/ai/neon-mcp-server", category: "Data", logo: true },
  { id: "figma", name: "Figma", vendor: "Figma", description: "Read design files, frames and components.", kind: "url", url: "https://mcp.figma.com/mcp", auth: "oauth", docs: "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/", category: "Design", logo: true },
  { id: "canva", name: "Canva", vendor: "Canva", description: "Find, create and edit Canva designs.", kind: "url", url: "https://mcp.canva.com/mcp", auth: "oauth", docs: registry("com.canva.mcp"), category: "Design", logo: false },
  { id: "webflow", name: "Webflow", vendor: "Webflow", description: "Manage sites, pages and CMS content.", kind: "url", url: "https://mcp.webflow.com/mcp", auth: "oauth", docs: registry("com.webflow"), category: "Design", logo: true },
  { id: "stripe", name: "Stripe", vendor: "Stripe", description: "Look up customers, payments and subscriptions.", kind: "url", url: "https://mcp.stripe.com", auth: "oauth", docs: "https://docs.stripe.com/mcp", category: "Payments", logo: true },
  { id: "paypal", name: "PayPal", vendor: "PayPal", description: "Work with invoices, orders and transactions.", kind: "url", url: "https://mcp.paypal.com/mcp", auth: "oauth", docs: registry("com.paypal.mcp"), category: "Payments", logo: true },
  { id: "square", name: "Square", vendor: "Square", description: "Look up payments, orders and catalog items.", kind: "url", url: "https://mcp.squareup.com/mcp", auth: "oauth", docs: "https://developer.squareup.com/docs/mcp", category: "Payments", logo: true },
];
