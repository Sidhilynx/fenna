/// <reference path="../../../../packages/shell/renderer/assets.d.ts" />
// Which AI the user has connected ("Ask Claude" / "Ask AI"), found by the shell; the
// whiteboard's own icon stands in when none is.

import { createAssistant } from "@opendeck/shell";
import appIcon from "../../build/icon.png";

export const { useAssistant, getAssistant, refreshAssistant, AssistantMark } = createAssistant({
  key: "od.whiteboard.assistant",
  icon: appIcon,
});

