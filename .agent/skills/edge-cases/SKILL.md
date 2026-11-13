---
name: edge-cases
description: How to test every path AGENTS.md rule 7 asks for (empty, huge, broken files, long titles, narrow window, keyboard only) on the real app with generated fixtures, and confirm results on disk. Use for every flow, and in full before hand-over.
---

# Breaking it on purpose

Every path, not just the happy one. Each case below is tried on the real
app, and the outcome is written in the hand-over.

## Make fixtures with a script, not by hand

Write a small Node script in `%TEMP%` that writes the fixture folders.
Don't put fixtures in the repo unless a test needs them, and never edit
`examples/`.

| Fixture | What it must show |
|---------|-------------------|
| Empty document (a new one) | The empty state from the reference: hints, the quick actions. No errors. |
| One element | Selection, editing, deleting it leaves a valid empty document. |
| Huge: 300 pages/sheets/frames and 5,000 to 100,000 elements (pick a size a real user could reach) | Opens in a few seconds; scrolling, zooming and editing stay smooth. Time an edit (below). |
| Very long titles and texts (200+ characters, no spaces too) | Ellipsis everywhere: tabs, menus, Home, panels. Nothing overlaps. |
| A broken file (truncated JSON, a wrong type, an unknown element kind) | A clear message saying what is wrong and what to do; the file is **left as it is on disk** (compare its bytes before and after); everything else still works and saves. |
| A missing file the index points to | Same as broken. |
| Old or odd values (an unknown property, an id where a label is expected) | Read leniently, shown sensibly, written back in the current form only when the user edits. |

Check "file untouched" with a byte comparison, not by eye:

```powershell
(Get-FileHash $copy\broken.json).Hash   # before and after the session
```

## Performance

Time from the user's action to the screen changing, inside the page:

```json
{"js": "window.__t=0;addEventListener('keydown',()=>window.__t=performance.now(),true);new MutationObserver((m,o)=>{window.__dt=Math.round(performance.now()-window.__t);o.disconnect()}).observe(document.body,{subtree:true,childList:true,characterData:true});'armed'"}
```

then the key steps, a wait, and `{"js": "window.__dt"}`. Over ~100 ms on
the huge fixture is a finding: profile with `node --cpu-prof` on the format
code and fix the hot spot.

Also check that **files of the huge size can be saved**. The shell refuses
writes over its `maxWrite` (2 MB by default, set per app in its main
process). If your format can exceed it, raise it in the app's main process
and say so in the hand-over.

## Window and input

- 1000x700: nothing important off-screen; toolbars fit or move into a
  "More" menu.
- Keyboard only: every action has a keyboard path (Tab to it, Enter or
  Space, Escape closes, arrows move), and every focusable control shows a
  focus ring. Try each flow without the mouse in a script that uses only
  `key` steps.
- Undo and redo after every kind of edit, including the multi-element ones,
  and after an AI edit made through the MCP server while the app is open.
- An edit made outside the app (the MCP server, or a file changed on disk)
  while the app is open shows up live, and doesn't lose the user's own
  unsaved work.

## Write it down

One line per case in the hand-over: fixture, what you did, what happened,
capture file name.
