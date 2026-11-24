---
name: pr-review-checklist
description: Use when a pull request is ready for review. Checks the change against a fixed list and writes the review comments with file and line.
category: engineering
saves: about 30 minutes
---

# Pull request review checklist

1. Read the pull request description and the diff. If the description is empty, say so first.
2. Check that the change does what the description says. Note anything it does beyond that.
3. Check for: tests added or changed for the change; error paths handled; no keys or secrets in the diff; no debug output left in; clear names; no unused code left behind.
4. Look harder at the risky parts: loading data, file paths, permissions, and anything that runs on a schedule.
5. Write each finding as one comment with its file and line, what is wrong, and the change you suggest. Mark each as "must fix" or "nit".
6. End with one line: approve, approve with nits, or request changes.

Output: a review in a doc, with the findings in the order of the diff and the verdict. Do not approve or merge the change in the repository yourself.
