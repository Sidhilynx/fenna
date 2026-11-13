# Privacy

Fenna has no account and no analytics. Your documents stay in folders on
your computer and are never sent to us. This page lists everything the apps
send over the network, and when.

## What the apps send

| What | To | When | What it contains |
|---|---|---|---|
| Update check | GitHub (`api.github.com`) | A few seconds after start, then once a day | A request for the latest Fenna release. GitHub sees your IP address and the app's name and version, as with any web request. Nothing about you or your files. |
| Fonts | Google Fonts | When a file uses a Google font | The font's name. |
| Setting up an AI app | Anthropic (Claude Code), GitHub (Codex) or Google (Antigravity) | Only when you choose to install one from the chat | A download of that app's official build. |
| AI chat | The AI service you chose (Anthropic, OpenAI or Google) | Only when you use the chat or ask the AI for something | What you send it, the parts of the open file it reads through its tools, and anything you attach. This goes through the AI app you installed and signed in to (Claude Code, Codex or Antigravity), under that service's own terms and privacy policy. |

That's all. Fenna doesn't run its own servers.

To turn the update check off, start the app with the environment variable
`FENNA_NO_UPDATE_CHECK=1`.

## Downloads

Installers are downloaded from GitHub Releases. GitHub counts downloads per
file and shows the count to us; that is the only usage number we have.

## If this changes

If a future version sends anything else (for example an anonymous count of
how many installs are in use), it will be listed here first, explained in the
release notes, and easy to turn off. A future cloud service with accounts
will have its own privacy policy and will always be optional.

## Questions

Open an issue at <https://github.com/Sidhilynx/fenna/issues>.
