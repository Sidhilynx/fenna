// Connectors the page offers to add in one step. Each entry was checked
// against the vendor's own documentation or the official MCP Registry
// (registry.modelcontextprotocol.io, whose names are tied to the vendor's
// domain). Crew does not check at run time that a vendor is who it says.
// A web address entry signs in through the sign-in flow in Connectors.tsx.
// The list is in the order the page shows it: featured first, then by
// category in CATEGORIES order, most used first within each.

export const CATEGORIES = ["Work", "Chat", "Dev", "Data", "Design", "Payments", "Search", "Storage", "Docs"] as const;
export type ConnectorCategory = (typeof CATEGORIES)[number];

export interface CatalogEntry {
  /** Also the connector's name once added, and the logo's key in connectorLogos.ts. */
  id: string;
  name: string;
  vendor: string;
  /** One plain line. */
  description: string;
  kind: "url" | "command";
  url?: string;
  command?: string;
  args?: string[];
  /** Values a command needs before it starts (an API key, say). The dialog asks for them when adding. */
  env?: { name: string; label: string; secret: boolean }[];
  /** oauth: the server signs the person in; token: a value must be pasted; none: nothing needed. */
  auth: "oauth" | "token" | "none";
  /** The page that shows the address or package. */
  docs: string;
  category: ConnectorCategory;
  /** Shown first, with a "Featured" label. */
  featured?: boolean;
}

const registry = (name: string) => `https://registry.modelcontextprotocol.io/v0.1/servers?search=${name}`;

export const CONNECTOR_CATALOG: CatalogEntry[] = [
  { id: "arsaze", name: "Arsaze", vendor: "Sidhilynx", description: "Edit videos: cuts, captions, b-roll and color.", kind: "url", url: "https://api.arsaze.com/mcp", auth: "oauth", docs: "https://arsaze.com/", category: "Design", featured: true },
  { id: "notion", name: "Notion", vendor: "Notion", description: "Search, read and edit pages and databases.", kind: "url", url: "https://mcp.notion.com/mcp", auth: "oauth", docs: "https://developers.notion.com/guides/mcp/get-started-with-mcp", category: "Work" },
  { id: "linear", name: "Linear", vendor: "Linear", description: "Find and update issues, projects and cycles.", kind: "url", url: "https://mcp.linear.app/mcp", auth: "oauth", docs: "https://linear.app/docs/mcp", category: "Work" },
  { id: "atlassian", name: "Jira and Confluence", vendor: "Atlassian", description: "Work with Jira issues and Confluence pages.", kind: "url", url: "https://mcp.atlassian.com/v2/mcp", auth: "oauth", docs: "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/", category: "Work" },
  { id: "asana", name: "Asana", vendor: "Asana", description: "Read and update tasks and projects.", kind: "url", url: "https://mcp.asana.com/v2/mcp", auth: "oauth", docs: "https://developers.asana.com/docs/using-asanas-mcp-server", category: "Work" },
  { id: "monday", name: "monday.com", vendor: "monday.com", description: "Read and update boards and items.", kind: "url", url: "https://mcp.monday.com/mcp", auth: "oauth", docs: registry("com.monday"), category: "Work" },
  { id: "todoist", name: "Todoist", vendor: "Todoist", description: "Find, add and complete tasks and projects.", kind: "url", url: "https://ai.todoist.net/mcp", auth: "oauth", docs: "https://www.todoist.com/help/todoist/todoist-and-ai/connect-todoist-to-an-ai-assistant-xMSzFfHng", category: "Work" },
  { id: "intercom", name: "Intercom", vendor: "Intercom", description: "Look up conversations and contacts.", kind: "url", url: "https://mcp.intercom.com/mcp", auth: "oauth", docs: "https://developers.intercom.com/docs/guides/mcp", category: "Work" },
  { id: "zapier", name: "Zapier", vendor: "Zapier", description: "Run actions in the apps connected to your Zapier account.", kind: "url", url: "https://mcp.zapier.com/api/v1/connect", auth: "oauth", docs: registry("com.zapier"), category: "Work" },
  { id: "slack", name: "Slack", vendor: "Slack", description: "Read and search channels and messages, and send messages.", kind: "url", url: "https://mcp.slack.com/mcp", auth: "oauth", docs: "https://docs.slack.dev/ai/slack-mcp-server/", category: "Chat" },
  { id: "github", name: "GitHub", vendor: "GitHub", description: "Read repositories, issues and pull requests, and change them.", kind: "url", url: "https://api.githubcopilot.com/mcp/", auth: "oauth", docs: "https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server", category: "Dev" },
  { id: "gitlab", name: "GitLab", vendor: "GitLab", description: "Read projects, issues and merge requests, and change them.", kind: "url", url: "https://gitlab.com/api/v4/mcp", auth: "oauth", docs: registry("com.gitlab"), category: "Dev" },
  { id: "sentry", name: "Sentry", vendor: "Sentry", description: "Look into errors, issues and releases.", kind: "url", url: "https://mcp.sentry.dev/mcp", auth: "oauth", docs: "https://mcp.sentry.dev/", category: "Dev" },
  { id: "vercel", name: "Vercel", vendor: "Vercel", description: "Look up projects, deployments and logs on Vercel.", kind: "url", url: "https://mcp.vercel.com", auth: "oauth", docs: "https://vercel.com/docs/agent-resources/vercel-mcp", category: "Dev" },
  { id: "cloudflare", name: "Cloudflare", vendor: "Cloudflare", description: "Manage Workers, DNS and the rest of the Cloudflare API.", kind: "url", url: "https://mcp.cloudflare.com/mcp", auth: "oauth", docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/", category: "Dev" },
  { id: "chrome-devtools", name: "Chrome DevTools", vendor: "Google", description: "Inspect and debug pages in a browser on this computer.", kind: "command", command: "npx", args: ["-y", "chrome-devtools-mcp@latest"], auth: "none", docs: "https://github.com/ChromeDevTools/chrome-devtools-mcp", category: "Dev" },
  { id: "playwright", name: "Playwright", vendor: "Microsoft", description: "Drive a browser on this computer.", kind: "command", command: "npx", args: ["@playwright/mcp@latest"], auth: "none", docs: "https://github.com/microsoft/playwright-mcp", category: "Dev" },
  { id: "pagerduty", name: "PagerDuty", vendor: "PagerDuty", description: "Look up incidents, services and on-call schedules.", kind: "command", command: "uvx", args: ["pagerduty-mcp"], env: [{ name: "PAGERDUTY_USER_API_KEY", label: "PagerDuty user API token", secret: true }], auth: "token", docs: "https://github.com/PagerDuty/pagerduty-mcp-server", category: "Dev" },
  { id: "airtable", name: "Airtable", vendor: "Airtable", description: "Read and edit records in your bases.", kind: "url", url: "https://mcp.airtable.com/mcp", auth: "oauth", docs: "https://support.airtable.com/docs/using-the-airtable-mcp-server", category: "Data" },
  { id: "supabase", name: "Supabase", vendor: "Supabase", description: "Manage projects, tables and queries.", kind: "url", url: "https://mcp.supabase.com/mcp", auth: "oauth", docs: "https://supabase.com/docs/guides/getting-started/mcp", category: "Data" },
  { id: "neon", name: "Neon", vendor: "Neon", description: "Manage Postgres projects, branches and queries.", kind: "url", url: "https://mcp.neon.tech/mcp", auth: "oauth", docs: "https://neon.com/docs/ai/neon-mcp-server", category: "Data" },
  { id: "mongodb", name: "MongoDB", vendor: "MongoDB", description: "Query and inspect collections in a MongoDB database.", kind: "command", command: "npx", args: ["-y", "mongodb-mcp-server"], env: [{ name: "MDB_MCP_CONNECTION_STRING", label: "Connection string", secret: true }], auth: "token", docs: "https://github.com/mongodb-js/mongodb-mcp-server", category: "Data" },
  { id: "pinecone", name: "Pinecone", vendor: "Pinecone", description: "Manage indexes and search records in Pinecone.", kind: "command", command: "npx", args: ["-y", "@pinecone-database/mcp"], env: [{ name: "PINECONE_API_KEY", label: "Pinecone API key", secret: true }], auth: "token", docs: "https://github.com/pinecone-io/pinecone-mcp", category: "Data" },
  { id: "huggingface", name: "Hugging Face", vendor: "Hugging Face", description: "Search models, datasets and Spaces on the Hugging Face Hub.", kind: "url", url: "https://huggingface.co/mcp", auth: "none", docs: "https://huggingface.co/mcp", category: "Data" },
  { id: "figma", name: "Figma", vendor: "Figma", description: "Read design files, frames and components.", kind: "url", url: "https://mcp.figma.com/mcp", auth: "oauth", docs: "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/", category: "Design" },
  { id: "canva", name: "Canva", vendor: "Canva", description: "Find, create and edit Canva designs.", kind: "url", url: "https://mcp.canva.com/mcp", auth: "oauth", docs: registry("com.canva.mcp"), category: "Design" },
  { id: "webflow", name: "Webflow", vendor: "Webflow", description: "Manage sites, pages and CMS content.", kind: "url", url: "https://mcp.webflow.com/mcp", auth: "oauth", docs: registry("com.webflow"), category: "Design" },
  { id: "stripe", name: "Stripe", vendor: "Stripe", description: "Look up customers, payments and subscriptions.", kind: "url", url: "https://mcp.stripe.com", auth: "oauth", docs: "https://docs.stripe.com/mcp", category: "Payments" },
  { id: "paypal", name: "PayPal", vendor: "PayPal", description: "Work with invoices, orders and transactions.", kind: "url", url: "https://mcp.paypal.com/mcp", auth: "oauth", docs: registry("com.paypal.mcp"), category: "Payments" },
  { id: "square", name: "Square", vendor: "Square", description: "Look up payments, orders and catalog items.", kind: "url", url: "https://mcp.squareup.com/mcp", auth: "oauth", docs: "https://developer.squareup.com/docs/mcp", category: "Payments" },
  { id: "brave-search", name: "Brave Search", vendor: "Brave", description: "Search the web, news and images with the Brave Search API.", kind: "command", command: "npx", args: ["-y", "@brave/brave-search-mcp-server"], env: [{ name: "BRAVE_API_KEY", label: "Brave Search API key", secret: true }], auth: "token", docs: "https://github.com/brave/brave-search-mcp-server", category: "Search" },
  { id: "tavily", name: "Tavily", vendor: "Tavily", description: "Search the web and read pages with the Tavily API.", kind: "command", command: "npx", args: ["-y", "tavily-mcp"], env: [{ name: "TAVILY_API_KEY", label: "Tavily API key", secret: true }], auth: "token", docs: "https://github.com/tavily-ai/tavily-mcp", category: "Search" },
  { id: "firecrawl", name: "Firecrawl", vendor: "Firecrawl", description: "Search, scrape and crawl websites with the Firecrawl API.", kind: "command", command: "npx", args: ["-y", "firecrawl-mcp"], env: [{ name: "FIRECRAWL_API_KEY", label: "Firecrawl API key", secret: true }], auth: "token", docs: "https://github.com/firecrawl/firecrawl-mcp-server", category: "Search" },
  { id: "dropbox", name: "Dropbox", vendor: "Dropbox", description: "Browse, search, read and move files in Dropbox.", kind: "url", url: "https://mcp.dropbox.com/mcp", auth: "oauth", docs: "https://help.dropbox.com/integrations/connect-dropbox-mcp-server", category: "Storage" },
  { id: "context7", name: "Context7", vendor: "Upstash", description: "Look up current documentation for code libraries.", kind: "url", url: "https://mcp.context7.com/mcp", auth: "none", docs: "https://github.com/upstash/context7", category: "Docs" },
  { id: "files", name: "Files", vendor: "Model Context Protocol", description: "Read and write files in folders listed in Arguments.", kind: "command", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], auth: "none", docs: "https://github.com/modelcontextprotocol/servers", category: "Docs" },
  { id: "memory", name: "Memory", vendor: "Model Context Protocol", description: "Keep notes between runs.", kind: "command", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], auth: "none", docs: "https://github.com/modelcontextprotocol/servers", category: "Docs" },
];
