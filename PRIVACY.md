# Privacy

Fenna has no account. Crew sends an anonymous daily count you can turn off,
and nothing about your files. Your documents stay in folders on your computer
and are never sent to us. This page lists everything the apps send over the
network, and when.

## What the apps send

| What | To | When | What it contains |
|---|---|---|---|
| Update check | GitHub (`api.github.com`) | A few seconds after start, then once a day | A request for the latest Fenna release. GitHub sees your IP address and the app's name and version, as with any web request. Nothing about you or your files. |
| Fonts | Google Fonts | When a file uses a Google font | The font's name. |
| Setting up an AI app | Anthropic (Claude Code), GitHub (Codex) or Google (Antigravity) | Only when you choose to install one from the chat | A download of that app's official build. |
| AI chat | The AI service you chose (Anthropic, OpenAI or Google) | Only when you use the chat or ask the AI for something | What you send it, the parts of the open file it reads through its tools, and anything you attach. This goes through the AI app you installed and signed in to (Claude Code, Codex or Antigravity), under that service's own terms and privacy policy. |

| Usage counts (Fenna Crew) | `usage.sidhilynx.com` | Once a day for each finished day, from a minute after start. Not before you have seen the notice on the overview. | Numbers only: the app version, your system, which AI apps are signed in, and counts such as runs and approvals. [The full list](#usage-counts). |
| Feedback (Fenna Crew) | `usage.sidhilynx.com` | Only when you press Send in the feedback window. | The text you wrote, your good or not good choice, the app version and your system. |

That's all.

To turn the update check off, start the app with the environment variable
`FENNA_NO_UPDATE_CHECK=1`. To turn usage counts off, see below.

## Usage counts

Fenna Crew counts how it is used, so we can see whether it works and where
people get stuck. The counts are numbers. They never hold your files, chats,
bot names or jobs, websites, connector names, logins, or anything about your
AI accounts.

Crew keeps the counts for each day in a small file on your computer
(`usage.json` in Crew's data folder). From a minute after it starts, and then
every six hours, it sends each finished day once, at most the last seven days.
Nothing is sent for today, and nothing is sent until the notice on the
overview has been answered. If a send fails, Crew tries again the next day.

The counts go to `usage.sidhilynx.com`, a Cloudflare Worker run by Sidhilynx.
The IP address is not stored. The code that receives them is in
[`services/usage`](services/usage) in this repository.

To turn it off, switch off "Send anonymous usage counts" in Crew's Settings,
or start Crew with the environment variable `FENNA_NO_USAGE=1`. Off means
nothing is counted or sent, and the stored counts are deleted.

What each ping holds:

| Field | Meaning |
|---|---|
| `v` | The version of this format, `1`. |
| `id` | A random number made once on this computer (a UUID). It is not made from your name, account or hardware. Turning counts off deletes it. |
| `app` | `crew`. |
| `version` | The Crew version. |
| `os`, `arch` | `win`, `mac` or `linux`; `x64` or `arm64`. |
| `day` | The local date the counts are for. |
| `cli` | Which of `claude`, `codex` and `agy` are installed and signed in on this computer. Nothing about the account. |
| `counts.bots`, `groups`, `connectors`, `logins` | How many bots, group chats, installed connectors and saved logins exist when the day is sent. Only the number; never their names or contents. |
| `counts.runs` | Runs that ended that day. |
| `counts.runs_ok`, `runs_failed` | Runs that finished, and runs that ended in an error. |
| `counts.runs_scheduled`, `runs_watch`, `runs_manual` | Runs started by a schedule, by a watch, and by you (a message or Run). |
| `counts.approvals`, `approvals_denied` | Approvals you answered, and how many of them you denied. |
| `counts.questions` | Questions from a bot that you answered. |
| `counts.take_control` | Times you took control of a bot's browser. |
| `counts.messages` | Messages you sent to bots and group chats. Only the count. |
| `counts.bots_created` | Bots created that day. |
| `counts.editor_opens` | Times a document, sheet or deck was opened in a bot's computer. |
| `first.signed_in`, `first.bot`, `first.run_ok` | Whether this install has ever signed in an AI app, had a bot of its own, and finished a run. |

Counts that are zero are left out.

Feedback is separate. The "Send feedback" window in Settings sends what is
in it only when you press Send, even if usage counts are off: the text, your
choice, the app version and your system. With counts off it uses a random
number that is not kept.

## Downloads

Installers are downloaded from GitHub Releases. GitHub counts downloads per
file and shows the count to us; that is the only usage number we have.

## If this changes

If a future version sends anything else, it will be listed on this page
first, explained in the release notes, and easy to turn off. A future cloud
service with accounts will have its own privacy policy and will always be
optional.

## Questions

Open an issue at <https://github.com/Sidhilynx/fenna/issues>.
