// The shell's page half: what every app on it shares. Import base.css once,
// first, in the app's entry; the components bring their own styles.
export { bridge, tabs, updates, userName, type ShellBridge } from "./bridge.ts";
export { AGENTS, AGENT_KINDS, agent, effortLabel, isReady, modelLogo, readyAssistant, runOnce, type AgentCatalog, type AgentEvent, type AgentKind, type AgentModel } from "./agents.ts";
export { activeChat, assistantOf, parseChats, type Chat, type ChatBook, type ChatItem } from "./chats.ts";
export { type Assistant, type AssistantSource, createAssistant } from "./assistant.tsx";
export { ChatPanel, type ChatPanelProps, type ChatView } from "./ChatPanel.tsx";
export { Home, type HomeItem, type HomeProps } from "./Home.tsx";
export { Dialog } from "./ui/Dialog.tsx";
export { ExportButton, type ExportFormat } from "./ui/ExportButton.tsx";
export { Icon, type IconName } from "./ui/icons.tsx";
export { Menu, MenuButton, shortcut, type MenuEntry, type MenuPrompt } from "./ui/Menu.tsx";
export { readPref, writePref } from "./prefs.ts";
export { Toast, toast } from "./Toast.tsx";
export { installTooltips } from "./tooltip.ts";
export { type Comment, type Thread, type ThreadBase, COMMENTS_FILE, MAX_COMMENT, ago, isText, parseThreads, serializeThreads } from "./comments/threads.ts";
export { type CommentsConfig, type CommentsState, type CommentsStore, createCommentsStore } from "./comments/store.ts";
export { ThreadCard, type ThreadCardProps } from "./comments/ThreadCard.tsx";
