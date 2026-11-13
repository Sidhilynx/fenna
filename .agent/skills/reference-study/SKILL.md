---
name: reference-study
description: How to read an app's reference screenshots and Claude's own tool and skill files for that kind of app, and turn them into a catalogue every later step builds against. Use before writing any code for a new app or feature.
---

# Studying the reference

The reference is the product. You build to it, not to your idea of it.

## Where it is

- `example-screenshots-<app>/`: screenshots of the product we match. They
  show another company's product: never copy their assets, logos, names or
  text into the app, and never publish them (the folder is git-ignored).
- `example-screenshots-<app>/claude-tools/` (when present): Claude's own
  tool definitions and skill files for this kind of app. They show what an
  AI must be able to do with a document of this kind and how its tools are
  shaped. They are internal reference: read them, never copy them into the
  repo or publish them.

## Reading screenshots without drowning

There can be many images. Do not open them all at once and then forget them.

1. List the folder. Open the images **in time order** (the file names are
   timestamps), a few at a time.
2. For each image write one catalogue row **right away**, before opening the
   next.
3. When an image shows a menu or panel, list **every** item in it, in order,
   with its shortcut and any check mark or side text. These lists are what
   you will check your capture against.
4. Note the state the image is in (what is selected, what is open), so you
   can reproduce it with a script later.

Images you cannot place: write "unclear" and what you think it might be.
Don't skip them.

## The catalogue: `docs/apps/<app>-reference.md`

```markdown
# <app> reference catalogue

## Flows
1. <flow name>: <images>  (one line each, in the order a person meets them)

## Images
### 014952 (Share/Export panel)
State: panel open from the Share button, Export tab.
Shows: title "Whiteboard", tabs Share | Export, ...
Items: PNG (Image) [download]; "Turn this board into": Slides, Docs, ...
We build: Export tab only (brief: no Share panel). PNG and ... 
```

Use only the file's time part (`014952`) as its name everywhere.

## Reading Claude's tools (`claude-tools/`)

For each tool write in the catalogue under "## What an AI must be able to do":

- the tool's name and purpose in one line;
- every argument, its type, allowed values and default;
- what it returns;
- the element kinds and properties it can create or change.

Then check two things and write the answers down:

1. **Format coverage.** Every element kind, property and value those tools
   can express must be storable in our format. List any gap and close it in
   the format package before building the UI.
2. **MCP shape.** The draft MCP server (`mcp-and-agent-check`) follows the
   same shape: similar tool count, similar argument names, results in the
   same spirit. Where ours must differ (local files, our format), say why.

## Then

The brief's "What it must do" names flows; your catalogue maps them to
images. If the brief and the images disagree, the brief wins on scope (what
we build) and the images win on look and behaviour (how it looks and acts).
Write each disagreement in your hand-over.
