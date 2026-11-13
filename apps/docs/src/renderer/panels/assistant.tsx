/// <reference path="../../../../../packages/shell/renderer/assets.d.ts" />
// Which AI the user has connected, as the page shows it: "@Claude" in the
// hint and the @ menu, its mark beside each line, "Ask Claude" on the bar.
// The shell finds it (packages/shell/renderer/assistant.tsx); docs gives its
// own icon for when none is connected.

import { createAssistant } from "@opendeck/shell";
import appIcon from "../../../build/icon.png";

export type { Assistant } from "@opendeck/shell";
export const { useAssistant, getAssistant, refreshAssistant, AssistantMark } = createAssistant({ key: "od.docs.assistant", icon: appIcon });
