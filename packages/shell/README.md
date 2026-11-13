# @opendeck/shell

The outside of every app in this repo: the window's tabs, Home, and the chat
with the user's own AI. Slides (`apps/desktop`) is the first app on it; docs,
sheets and the rest plug into the same shell, so they look and behave the
same and a fix here lands in all of them.

What an app brings: its document format, its editor, and its MCP server.
Everything around those comes from the shell.

## What's in it

| Part | Where | What it does |
| --- | --- | --- |
| Window tabs | `main/tabs.cjs`, `main/strip/` | A strip of tabs (Home + one per open folder), drag, hover preview, Ctrl+T/W/Tab, restore on launch, a spinner while the AI works |
| Preload | `main/preload.cjs` | The page's one door to the main process: `window.shell.invoke/send/on` |
| Assistant host | `main/agent.cjs` | Runs Claude Code, Codex or Antigravity on the user's plan with only the app's MCP tools; installs them (official builds, checksum checked), signs in through the browser, reads models and efforts from each CLI, keeps chats per folder |
| Chat panel | `renderer/ChatPanel.tsx` | Chat tabs, history, who-answers / model / effort / account pickers, the install and sign-in card, the live reply |
| Home | `renderer/Home.tsx` | Greeting, a composer to start a document, recent documents with search |
| UI kit | `renderer/ui/`, `renderer/base.css` | Tokens (both themes), buttons, menus, dialogs, icons |

## Plugging in a new app

Main process:

```js
const { TabHost, PRELOAD, registerAgent, registerShell } = require("@opendeck/shell/main");

registerShell({ assertSender });
registerAgent({
  getRoot: (webContents) => folderOpenIn(webContents),
  assertSender,
  profile: {
    id: "fenna-sheets",                                   // your MCP server's name
    mcpServer: (root) => ({ command, args, env }),     // start it for an open folder
    note: "You are the assistant inside Fenna Sheets…",   // told once per conversation
    toolLabel: (tool, params) => (tool === "write_cells" ? "Edited cells" : null),
  },
});
const tabs = new TabHost({
  window, preload: PRELOAD, userDataDir, load, setRoot, trust, themeMode,
  product: { name: "Fenna Sheets", kind: "sheet", kindName: "Sheet", marker: "sheet.json" },
});
```

Page:

```tsx
import "@opendeck/shell/base.css";
import { ChatPanel, Home, bridge, tabs } from "@opendeck/shell";

<Home noun="sheet" nouns="sheets" items={recent} onStart={…} onOpen={…} onChoose={…} placeholder="What should we make?" />
<ChatPanel noun="sheet" view={{ context: { sheet, selection }, label: "Sheet 1 · B2:D9" }} suggestions={[…]} intro="…" placeholder="…" onWorking={…} />
```

Your own calls to your main process go over `bridge().invoke("sheet:read", …)`;
name them `<app>:<verb>`.

## Rules

- Nothing app-specific in here: no slide, sheet or doc words, no app's file
  names. An app passes them in.
- Visuals and behavior may follow Arsaze; no Arsaze AI logic, prompts or
  services.
- The repo's rules (AGENTS.md) apply: tokens only, both themes, keyboard
  paths, no new dependencies.
