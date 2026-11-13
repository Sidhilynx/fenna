---
name: known-mistakes
description: A checklist of the concrete mistakes earlier builds in this repository made and the finishing pass had to fix. Go through it item by item while building each flow and again before hand-over.
---

# Mistakes earlier builds made

Each of these was found by the finishing pass in a build that "worked".
Check each one against your app before you hand over. Write "checked" or
what you found for each in your notes.

## Data and format

- [ ] **Edits that move things don't update what points at them.** In
      sheets, inserting a row left formulas, charts, rules and comments
      pointing at the wrong cells. In a board: deleting or moving an element
      must update connectors attached to it, frames containing it, groups,
      comments anchored to it, and links to it.
- [ ] **The sample is not in the current format.** It stored ids where the
      format says labels, dates as text where it says numbers. The sample
      must load with zero problems and use every element kind exactly as the
      schema says. Write a test that loads it and checks there are no
      problems.
- [ ] **Text input not parsed the way people type.** Dates, money, percent,
      locale. Anything a person types must be read the way they meant it.
- [ ] **Silently dropped input.** Unknown properties, unknown argument
      names, invalid colors accepted as-is (`"red"`, `"#FFCCCC"`). Validate,
      normalize (lowercase hex), or refuse with a fix-it message.
- [ ] **Large files can't be saved.** The shell refuses writes over 2 MB by
      default. Test saving your huge fixture.
- [ ] **Undo keeps whole copies of the document per step.** Cap undo by
      size as well as count.
- [ ] **Re-reading what you just wrote.** Parsing the file text you just
      serialised on every edit made big documents slow. Keep the object.

## UI

- [ ] **Menus that are "similar" to the reference.** Every item, order,
      shortcut text, check mark and side text must match the reference
      image. List them from the image and compare item by item.
- [ ] **Missing features visible in a reference image** (an item in a menu
      you didn't build). Every visible control works or is listed as a gap.
- [ ] **Overlays with no opaque background**: frozen areas, sticky headers
      and floating bars that let content show through when scrolling or
      panning.
- [ ] **z-order bugs**: lines drawn over popups, popups under toolbars,
      selection handles under other elements.
- [ ] **Positioned things that don't move with what they belong to**
      (charts stayed put when columns moved). On a board: labels on
      connectors, handles on rotated elements, toolbars on moved elements.
- [ ] **Text clipped mid-letter** instead of an ellipsis, in menus, tabs and
      Home.
- [ ] **Home cover**: the document's thumbnail on Home must be legible at
      Home's size (48x27 in the list), not a cropped full-size render.
- [ ] **Scroll position**: lists that open scrolled to the wrong place
      (choices not scrolled to the current one; chat opened at the bottom).
- [ ] **Light theme** never looked at. Look at it.
- [ ] **Keyboard**: arrows landing on hidden things, no focus ring, actions
      with no shortcut that the reference shows a shortcut for.

## MCP and agents

- [ ] **The model's summary taken as proof.** Check results on disk.
- [ ] **Errors that don't say how to fix them.**
- [ ] **Results that hide a surprise** (an insert that didn't extend
      ranges, a value stored differently from its neighbours). Say it in
      the result.

## Process

- [ ] Changing `packages/shell` or another app instead of asking (write
      "Core changes needed").
- [ ] Dead code left after a rewrite (old components, unused exports).
      Search for each exported name you added; remove it if nothing uses it.
- [ ] Claiming checks you did not run. Every claim in the hand-over names
      its capture, test or trace.
