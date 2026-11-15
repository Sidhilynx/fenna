/// <reference path="../../../../packages/shell/renderer/assets.d.ts" />
// AI assistant state provided by the shell.

import { createAssistant } from "@opendeck/shell";
import appIcon from "../../build/icon.png";

export const { useAssistant, getAssistant, refreshAssistant, AssistantMark } = createAssistant({
  key: "od.design.assistant",
  icon: appIcon,
});

