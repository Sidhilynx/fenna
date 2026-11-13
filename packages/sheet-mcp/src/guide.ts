// What a model is told about the Fenna Sheets format. The reference parts are
// generated from @opendeck/sheet, so they can never drift from what the
// engine and the validator accept. The working notes are ours.

import {
  BORDER_STYLES,
  CELL_TYPES,
  CHART_TYPES,
  DROPDOWN_TEMPLATES,
  FONT_SIZES,
  FUNCTIONS,
  HIGHLIGHT_CONDITIONS,
  HIGHLIGHT_LABELS,
  LOCALES,
  NUMBER_FORMATS,
  OPTION_COLORS,
} from "@opendeck/sheet";

/** Short form, sent as the server's instructions on connect. */
export const INSTRUCTIONS = `You edit a Fenna Sheets workbook: a folder on the user's computer with sheet.json (title, locale, time zone, sheet list, dropdowns, people) and one JSON file per sheet. The user sees every change on screen as you save it.
Start with workbook_overview. Read before you write: read_range shows what cells show and the cells as the file keeps them, with a version to pass back.
Write values and formulas with write_cells (cells by address, or a block of rows), style ranges with format_cells, change rows, columns, sorting, freezing and filters with edit_structure. Rows are numbered from 1 and columns are letters, as on screen.
Use real formulas for anything computed (=SUM(B2:B9), =B2/C2), never numbers you worked out yourself, so the sheet stays right when inputs change. The reply to each write says what your formulas now show; fix any error it reports.
Comments: read_comments lists what people asked; answer with comment. Questions go in comments, changes go in cells.
Call format_guide once before your first write. Never invent data the user didn't give you: leave cells empty or use clearly marked sample values, and say so.`;

export function formatGuide(): string {
  const fmts = NUMBER_FORMATS.map((f) => `- ${f.kind}: ${f.label}, shows ${f.example}`).join("\n");
  const fns = FUNCTIONS.map((f) => `- ${f.sig}: ${f.desc}`).join("\n");
  const conds = HIGHLIGHT_CONDITIONS.map((c) => `${c} (${HIGHLIGHT_LABELS[c].toLowerCase()})`).join(", ");
  return `# The Fenna Sheets format

## Cells
A cell is written as one of:
- a number (42500), true/false, or text ("East region")
- a formula: text starting with = ("=SUM(B2:B9)")
- null: empties the cell, style and all
- an object: {"v": value, "f": "=formula", "t": type, "s": style, "dropdownId": "…", "person": {"name", "email"?}, "note": "…"}
Text is read the way typing it would be: "2026-03-15" and "3/15/2026" become dates, "2:30 PM" a time, "$1,200" money, "12.5%" a percentage, and the cell gets the matching number format. Start text with ' to keep it as text ("'0042").
Dates and times are serial numbers (days since 1899-12-30; 0.5 is noon), so =B2+7 is a week later and =C2-B2 is days between.

## Types (t)
${CELL_TYPES.filter((t) => t !== "auto").map((t) => `- ${t}`).join("\n")}
- checkbox: v is true or false.
- dropdown: dropdownId names a dropdown in sheet.json; v is the chosen option's label. Ready-made ones (added to the workbook when first used): ${DROPDOWN_TEMPLATES.map((d) => `${d.id} (${d.options.map((o) => o.label).join(", ")})`).join("; ")}. Make others with update_workbook (option colors: ${OPTION_COLORS.join(", ")}).
- person: person {"name", "email"?}; v is the name.
- date: shows a date picker; v is a date.

## Style (s)
- bold, italic, underline, strike: true or false
- fontSize: points, one of ${FONT_SIZES.join(", ")} (default 10)
- color (text) and fill (background): "#rrggbb"
- alignH: auto, left, center, right (auto puts numbers right and text left)
- alignV: top, middle, bottom
- wrap: overflow (text runs into empty neighbours) or wrap
- borders: {"top"|"right"|"bottom"|"left": {"style": ${BORDER_STYLES.join("|")}, "color": "#rrggbb"}}
- numFmt, and customFmt when numFmt is "custom"

## Number formats (numFmt)
${fmts}
- custom: customFmt is a pattern: "#,##0.00", "0.0%", "$#,##0;($#,##0)" (negatives in brackets), "yyyy-mm-dd", "mmm d", "h:mm AM/PM".
Locales (sheet.json locale, which sets the currency and how dates are written): ${LOCALES.map((l) => l.id).join(", ")}.

## Formulas
References: B2, $B$2 (locked when copied), B2:D9, B:B (a whole column), 3:3 (a whole row), B2:B (from B2 down), and other sheets as Revenue!B2 or 'Q3 Plan'!B2:B9 (quote names with spaces).
Operators: + - * / ^ & (joins text) = <> < <= > >= and % after a number.
Criteria in COUNTIF, SUMIF and the like: ">100", "<>Done", "East", "A*" (* and ? are wildcards).
Errors read as #DIV/0!, #VALUE!, #REF!, #NAME?, #N/A, #NUM!; read_range and every write say why.
Functions that return a list (FILTER, UNIQUE, SORT, ARRAYFORMULA, SPLIT) are not supported: write the result out, or use COUNTIF/SUMIFS/INDEX/MATCH.

${fns}

## Conditional formatting (manage_rules)
- highlight: {"kind": "highlight", "range", "condition", "values": [...], "style": {"fill", "color", "bold", "italic"}}. Conditions: ${conds}.
- colorScale: {"kind": "colorScale", "range", "minColor", "midColor"?, "maxColor"}.

## Charts (manage_charts)
Types: ${CHART_TYPES.join(", ")}. The range holds category labels in its first column, one series per further column, and series names in its first row.

## Building sheets that work
- One table per sheet, starting at A1, headers in row 1 (bold, then freeze row 1), one record per row, one kind of value per column.
- Compute with formulas that point at the inputs. Totals go in a row below the data or a column to its right, labelled.
- Give numbers a number format (currency, percent, dates) with format_cells rather than typing symbols into text.
- Put assumptions (rates, targets) in their own labelled cells and point formulas at them with $ locks.
- Keep the user's layout: change only what was asked, and read before you overwrite.`;
}
