# Fenna Sheets (sheets)

Stage: production
Reference: `example-screenshots-sheets/`
Code: `apps/sheets`, `packages/sheet`, `packages/sheet-mcp`

## What it is for

A spreadsheet for people who keep numbers and lists with an AI beside them:
budgets, trackers, plans, small reports. A workbook is a folder on their
computer (`sheet.json` plus one JSON file per sheet), so it outlives the app
and any AI that speaks MCP can read and change it while they watch. In five
minutes a person should be able to start a sheet, type values and formulas,
format them, make a chart, and ask the AI to add a column or build a table.

## What it must do

- Create, open, save: Home with recent workbooks; open a folder; start blank
  or import CSV or Excel; every edit saved; undo and redo; version history
  with restore. Reference 011414, 011430, 012244, 012300.
- Edit cells: values, formulas with suggestions and references by pointing,
  dates, money and percentages typed the way people write them; fill,
  copy, cut and paste (values only too); find the end of the data with
  Ctrl+arrows. Reference 011504, 011914.
- Cell types: checkbox, dropdown chips (ready-made Status and Priority, or
  new ones), people, dates. Reference 011905.
- Format: bold, italic, underline, strikethrough, colors (standard and
  custom), borders with color and thickness, alignment, font size, wrapping,
  number formats including custom patterns, locale and time zone.
  Reference 011527–011648, 011841, 011854, 011905–011939, 012011.
- Rows and columns: insert, delete, move, resize, freeze, group, sort,
  filter; formulas, rules and charts follow the cells. Reference 011949,
  012002, 012102–012147.
- Conditional formatting (highlight and color scale) and charts (bar, line,
  pie, area). Reference 011648, 011801–011827.
- Sheets: tabs, the list of all sheets, add, rename, duplicate, move,
  delete. Reference 012350.
- Work with the AI: the Ask bar on the toolbar and in menus, and the chat
  column. Reference 011504.
- Comments on cells. Reference 012229.
- Export: Excel and CSV. Reference 011440 (export half).

## What it must not do

- Accounts, invitations, public links, "send to" another company's app (see
  the docs brief: the folder is the thing shared).
- Pivot tables, macros or scripts, external data connections.
- Nested (multi-level) row and column groups.

## Agent tasks

1. Act on an open comment that asks for a new row in a table: add it where it
   belongs so totals, growth and the chart include it, and reply in the
   thread.
2. Add a column that averages each row's months, with a total, formatted like
   its neighbours.
3. Build a new budget sheet from a few lines of notes: categories, planned
   and actual, a variance formula, a total row, a rule that marks overspend,
   the header frozen.
4. On a task tracker: mark a task done (checkbox and status), add a task with
   an owner, priority, status and due date, and sort the tasks by due date.

## Decisions

- Export only (Excel, CSV), no Share panel, as in docs: the folder is the
  thing shared. 2026-11-13.
- Files keep dates and times as serial numbers and dropdown choices as their
  labels; older text dates and option ids are still read. 2026-11-13.
- Time zones go by their current names ("Asia/Kolkata"); legacy names a
  system reports are mapped. 2026-11-13.
- Inserting, deleting or moving rows and columns moves every formula (on all
  sheets), rule, chart, filter, group and comment with its cells. A deleted
  reference becomes #REF!. Ranges that end just above an insertion do not
  grow, as in any spreadsheet; the MCP server says which. 2026-11-13.
- Charts are placed in pixels but keep their place in the cell they start
  in when rows or columns are inserted, deleted or resized. 2026-11-13.
- A new formula takes the number format of the first cell it reads when its
  result keeps the unit (SUM, AVERAGE, MAX, ROUND, + and −); counts, ratios
  and text don't. 2026-11-13.
- Groups are one level deep: a new group joins any group it overlaps.
  2026-11-13.
- Big workbooks: the app writes sheet files up to 64 MB. A workbook too big
  for one 12 MB history version keeps no history; undo still works, and
  keeps at most 200 steps or 200 M characters. 2026-11-13.
- The MCP server refuses argument names a tool doesn't take and lists the
  ones it does, so a guessed name fails instead of being dropped.
  2026-11-13.
- 2026-11-13: The family is called Fenna, by Sidhilynx ("Fenna Sheets"); MCP server `fenna-sheets`, format marker `fenna-sheets/0` (the old marker is still read). Chosen after a trademark and name search; Lynx and the open- names were taken.
- 2026-11-13: No login or account in the app. Demand is measured by release downloads, not by users; a future cloud service will be optional. Home's bottom-left shows an available update, never a person.

## Build summary

Written after the fact by the finish pass (the builder left none): the grid,
the format, formulas, a toolbar, cell types, charts, rules and a draft MCP
server existed, built against the reference but unpolished; several paths
(structural edits, dates, locales) were incomplete. See
`docs/reviews/sheets-2026-11-13.md` for what the finish pass changed.
