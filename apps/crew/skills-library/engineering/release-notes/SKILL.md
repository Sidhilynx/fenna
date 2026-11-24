---
name: release-notes
description: Use before a release. Writes the release notes from the merged changes: what is new, what changed, what is fixed and what breaks.
category: engineering
saves: about 45 minutes
---

# Release notes

1. Read the list of changes since the last release: the commit log or the merged pull requests, from Files or the tracker.
2. Sort each change into one group: new, changed, fixed, removed, or breaking. Drop internal changes a user would not notice.
3. Write each entry in one line, in words a user would use, with its issue or pull request number.
4. Put breaking changes first, each with what the user must do about it.
5. Check the version number and the date with the person.
6. Keep the notes to one screen unless the person asks for more.

Output: a markdown file in Files named for the version, with the headings in this order: breaking, new, changed, fixed, removed. It is ready to paste into the release page.
