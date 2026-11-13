/// <reference path="../../../../packages/shell/renderer/assets.d.ts" />
// Which AI the user has connected ("Ask Claude"), found by the shell; the
// sheet's own icon stands in when none is.

import { createAssistant } from "@opendeck/shell";
import appIcon from "../../build/icon.png";

export const { useAssistant, getAssistant, refreshAssistant, AssistantMark } = createAssistant({ key: "od.sheets.assistant", icon: appIcon });
