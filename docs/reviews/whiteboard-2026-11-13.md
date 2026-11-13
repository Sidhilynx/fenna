# whiteboard review, 2026-11-13

Reviewer: Claude Opus 5.5  Stage: verify and finish  Commit: d012893 (plus this pass, uncommitted)

## Summary
The builder's openboard looked like a whiteboard in one screenshot but could
not be used: text couldn't be edited, moves were never saved, icons were
emoji, and the MCP server was a draft. The editor, the format and the server
were rewritten on the shell, following the sheets app. Each of the 26 reference
screens now has a matching state in the app, checked side by side at 1440×900
and 1000×700 in both themes. Edits save to disk, undo works, and damaged files
are left alone. All four agent tasks pass with Gemini 3.8 Flash and Claude Sonnet 4.6, checked on disk (table below). No
blocker or major finding is open.

## Findings
| # | Area | Severity | Finding | Evidence | Outcome |
|---|------|----------|---------|----------|---------|
| 1 | ux | blocker | Moving items was never saved: drags changed the screen only, so a reload lost them. | `Canvas.tsx` move path called `setState` without a save; builder's capture flow | fixed: every gesture ends in one `commit` (undo step + atomic write); disk checked after a scripted drag (`s-mcp` at 1100,775, out of its frame) |
| 2 | ux | blocker | Text could not be edited: `editingId` was set and nothing read it. | Double-click did nothing | fixed: in-place editor over the renderer's own text box (stickies, text, shapes, frame titles, connector labels, table cells); typed text saved (`ui3-*/b-editing.png`, disk) |
| 3 | ux | blocker | Resize and rotate pushed an undo step and a save on every mouse move. | `updateItem` in `onMouseMove` | fixed: preview while dragging, one step at the end |
| 4 | ux | major | Renaming the board never saved; the zoom menu settings (shortcuts, chime) never saved. | `HeaderBar` set state only | fixed: board.json written; Rename dialog as in sheets |
| 5 | visual | major | Emoji everywhere in the UI (dock, shape picker, share button); against the look rules. | builder capture `before/board.png` | fixed: shell glyphs; seven glyphs added to `packages/shell` (hand, frame, sticky, arrowDiagonal, unlock, capDot, lineStyle); shape icons drawn from the format's own outlines |
| 6 | visual | major | Text didn't wrap: sticky text ran out of the note. | `before/board.png` | fixed: one wrapping function (`packages/board/src/text.ts`) for canvas, export and MCP; overflow ends in an ellipsis |
| 7 | visual | major | Floating bars, "…" menu, zoom menu, shape library and line popovers differed from the reference. | 015053–015702 vs builder steps | fixed: rebuilt per kind; each compared: sticky (015434/015456 ↔ `ui1/02`, `04`), text (015053, 015110, 015119 ↔ `07`, `08`), frame (015400, 015407, 015414 ↔ `12`, `13`), connector (015246, 015256, 015303, 015310 ↔ `ui2/34`–`36`), shape (015641 ↔ `14`), zoom menu (015007 ↔ `16`), size menu (015102, 015442 ↔ `03`) |
| 8 | ux | major | Connectors were absolute points: moving an item left its arrow behind. Elbow routes cut through shapes. | builder canvas | fixed: ends attach to items (and sides); routes chosen by a scored orthogonal router that steps out of each item and never doubles back |
| 9 | ux | major | Frames: children listed twice (`childIds` and `frameId`), no drop-into-frame, frames drawn over their contents. | sample canvas.json | fixed: one field (`frame`); dropping an item in a frame files it; frames always sit behind what they hold; moving a frame moves its contents |
| 10 | ux | major | No version history, no comments on the board, stickers and images could not be placed, the timer had no countdown. | brief "What it must do" | fixed: history panel with restore; pins and thread cards on the canvas plus the comments panel (015216); stickers (own vector art) and images (picker, paste, drop); timer with presets, pause, +1 min and chime |
| 11 | agent | major | Draft MCP server: aliases silently accepted, no placement help, no layout check, results without what to fix. | builder transcripts | fixed: redesigned (9 tools, strict arguments, all-or-nothing, automatic placement in frames, `flow` layout, a "Check:" list in every result); `packages/board-mcp/README.md` |
| 12 | agent | major | Gemini Flash cleared the whole sample board (17 items, `with_contents: true`) and renamed it before making the retro in task 1. | trace `55c2b9e9`, step 35 | fixed: instructions and `delete_items`/`rename_board` descriptions say the board is the person's work; rerun below |
| 12a | agent | major | Claude Sonnet 4.6 called `edit_items` with `items` (the name `add_items` uses) in all four tasks, and the error ("expected array, received undefined at edits") didn't say why. | traces `7ef6f460` step 9, `6e3efc82` step 7, `43c34972` step 7, `26795363` step 5 | fixed: `edit_items` takes `items`; a missing argument now says "<tool> needs <arg>; it takes …"; rerun below |
| 12b | agent | major | The layout check ignored frames, so two overlapping frames (task 4, Sonnet) passed as clean. | `t4-claude-sonnet-4-6` on disk: `f-ux` y 140–400, `f-data` y 370–630 | fixed: frames overlapping each other or covering items they don't hold are reported; rerun below |
| 12c | agent | minor | Sonnet sent a batch to `arrange` (`{arrange: [...]}`) and was told only that `layout` was invalid. | trace `7ef6f460` step 5 | fixed: "arrange needs layout … (one call per layout)" |
| 12d | agent | minor | Sonnet guessed `includeResolved` for `include_resolved`. | trace `43c34972` step 3 | won't fix: the error names the argument and the retry worked |
| 13 | ux | major | A canvas.json that couldn't be read loaded as an empty board and the next save would overwrite it. | builder reader | fixed: banner, nothing saved; file byte-identical after an attempted edit (`ui5-broken`); entries that fail the check are kept and written back |
| 14 | visual | minor | The board opened at the wrong zoom in a 1000×700 window (fit ran before the canvas had a size). | `ui3-1000x700-*` at 74% | fixed: fit waits for the first measure (`ui4/a-fit.png`, 52%) |
| 15 | visual | minor | The floating bar covered the rotate handle. | `ui1/02` | fixed: the handle sits above the bar, as in 015434 |
| 16 | ux | minor | An open comment showed twice (canvas card and expanded panel card). | `ui1/22` | fixed: panel cards stay collapsed and open the card on the board |
| 17 | ux | minor | Connector labels were measured at 13 px and drawn at 14 px, so they were cut ("reads and…"). | `v1/board.png` | fixed |
| 18 | ux | minor | Two items closer than two route stubs got a hooked connector. | `ui2/35` | fixed: facing stubs share the gap |
| 19 | visual | minor | Home showed no cover. | builder Home | fixed: the board itself in miniature, text as bars (`ui4/e-home.png`) |
| 20 | visual | minor | Connectors meet curved shapes (cloud, rotated items) at their bounding box, a few pixels off the outline. | `v1/board2.png` cloud | won't fix now: sides of rects, pills, diamonds and hexagons are exact |
| 21 | ux | minor | Elbow routes avoid the two items they join but may cross others. | `ui2/38` | won't fix now: the reference shows the same; `arrange` with `flow` lays diagrams out so they don't |
| 22 | visual | minor | Share tab, invitations, "turn into slides/docs", send-to apps, "Follow me" (014952, 015007) are absent. | brief "must not do" | won't fix: out of scope; Export (PNG, SVG) stands in for Share as in docs and sheets |
| 23 | visual | minor | Reference stickers are illustrated; ours are simple vector drawings. | 015702 | won't fix: the reference art is another company's; ours are original |
| 24 | ux | minor | Stickers can be searched but not "made" from words. | 015702 search box | won't fix now: Ask the AI to add a sticker instead |

## Edge cases
Captured and checked:
- empty board (light, 1000×700): tools work, Enter with a tool places an item;
- damaged canvas.json: banner, file untouched after an attempted edit;
- 100 frames and 5,000 stickies, a 200-character title: opens fitted at 5%, 20 zoom steps in 36 ms, 265 items drawn on screen, a typed sticky saved (5,101 items on disk), title ellipsized;
- very long text without spaces: wraps by letters, ends in an ellipsis (tests);
- keyboard only: tool keys, Enter to place or edit, arrows to nudge, Esc out of each layer, menu shortcuts;
- both themes and both sizes for the main states (`ui3-*`).

## Agent tasks
`node scripts/agy-try.mjs --board <copy> --model <m> "<task>"`, each on a fresh copy of
`examples/sample-board`, checked on disk with the format's own reader and
layout check (not the model's summary), then opened in the app.

| Task | Model | Result | Calls (failed) | On disk |
|---|---|---|---|---|
| 1. Retro board | Gemini 3.8 Flash | fail, then pass | 8 (0); rerun 5 (0) | First run (`55c2b9e9`) deleted the 17 sample items before making the retro (finding 12). Rerun (`970260ce`) after the description fix: three frames with 3, 2 and 2 stickies in their colors, in rows, beside the board; nothing removed; no layout problems |
| 1. Retro board | Claude Sonnet 4.6 | pass | 8 (2) | `7ef6f460`: three colored frames, notes in rows inside, placed below the board; nothing removed; no layout problems. Failed calls: `arrange` batch, `edit_items` with `items` (findings 12a, 12c) |
| 2. Flowchart | Gemini 3.8 Flash | pass | 4 (0) | `bdbafaa5`: pill, rect, diamond, rect, pill joined top to bottom, "Yes" down, "No" back up into Enter email; nothing overlapping (`agentshots/t2-gemini…png`) |
| 2. Flowchart | Claude Sonnet 4.6 | pass | 8 (2); rerun 5 (1) | `6e3efc82` and rerun `062c21e0`: the same diagram (Enter email as a parallelogram), beside the board, no overlaps. Rerun failure: `color` for a shape fill, now answered with "use fill" |
| 3. Act on the comment | Gemini 3.8 Flash | pass | 7 (0) | Only `s-mcp` changed: a third line about real-time sync; reply in `t-sticky-change`, thread resolved |
| 3. Act on the comment | Claude Sonnet 4.6 | pass | 6 (2); rerun 4 (0) | Same change and a reply (thread left open). Rerun `23454c50`: no failed calls after the `items` rename |
| 4. Group loose stickies | Gemini 3.8 Flash | pass | 9 (0) | `eda633da`: frames "Shortcuts & toolbar" and "Backups & snapshots" holding the four loose notes; words, authors and colors unchanged; no layout problems |
| 4. Group loose stickies | Claude Sonnet 4.6 | pass | 4 (1); rerun 9 (1) | First run left its two frames overlapping by 30 units, unreported (finding 12b). Rerun `a8fa9d19`: told of the overlap, it moved the frames apart; notes unchanged; no layout problems |

Server tests: `packages/board-mcp/test/server.test.ts` (15).
