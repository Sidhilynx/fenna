---
name: bug-report-triage
description: Use when a bug report comes in. Turns it into a clear report with steps to reproduce, a severity and the area it belongs to.
category: engineering
saves: about 30 minutes
---

# Bug report triage

1. Read the report and any logs or screenshots the person attaches in Files.
2. Write a title that says what goes wrong, in one line. For example: "Export drops the last row of a sheet".
3. Write the steps to reproduce, numbered. If they are missing, list what to ask the reporter for. Do not guess the steps.
4. Write the expected result, the actual result, the app version, the system, and how often it happens.
5. Give a severity: data loss or a crash that stops the main job is high; a visibly wrong result is medium; a small glitch is low. Give the reason in one line.
6. Search the issue list the person names for a duplicate. Link any duplicate you find.
7. If the person names the code, suggest the area it belongs to.

Output: a report in a doc, ready to file: title, steps, results, severity with its reason, duplicates, and what the reporter still needs to send.
