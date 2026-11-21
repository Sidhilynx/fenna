# Local models

Fenna's assistant can answer with a model that runs on your own computer. The
text never leaves the machine, and you need no account and no plan for it.

A local model runs through Codex. Codex runs the tools and Fenna's MCP server;
the model itself runs in Ollama or LM Studio. So you need Codex installed, but
not signed in.

## Set up

1. **Install a model server.** Either:
   - [Ollama](https://ollama.com), or
   - [LM Studio](https://lmstudio.ai).
2. **Download a model that can use tools.** Pick one from the list below, or
   check a model's page for tool use before you download it.
   - Ollama: `ollama pull qwen3:8b`, or `ollama pull gpt-oss:20b` if the
     computer has the memory for it.
   - LM Studio: search for the model in its Discover tab and download it.
3. **Start the server.**
   - Ollama runs in the background after it is installed. If it isn't running,
     start it with `ollama serve`.
   - LM Studio: open the Developer tab and start the server. It listens on
     port 1234.
4. **Install Codex in Fenna.** Pick Codex in the assistant and use Install. The
   app keeps its own copy, as it does for the other assistants.
5. **Pick the model under "On this computer".** It is in the assistant's model
   menu and in a bot's brain. Its size is shown beside it.

If a model is listed but a run says the server isn't running, start the
server and try again. Fenna lists only the models the server reports, and it
looks again when you choose Refresh models in the assistant's account menu.

## Models to start with

These are good places to begin. Sizes are approximate.

| Model | Size | Notes |
|---|---|---|
| `qwen3:8b` | 8B, about 5 GB | A good first choice on a laptop with 16 GB of memory. |
| `qwen3:14b` | 14B, about 9 GB | Better at multi-step edits. Needs more memory and is slower. |
| `gpt-oss:20b` | 20B | Strong at tool use. Needs a lot of memory. |
| `llama3.1:8b` | 8B | An older, well-tested choice. |

## Limits

- **Small models often fail at tool use.** Under 7 billion parameters, the
  picker and the chat say so. Use 7B or larger for real work.
- **Speed depends on the computer.** A model that doesn't fit in memory is much
  slower. A GPU, or Apple silicon with enough memory, makes the biggest
  difference.
- **Context is limited.** A long document may not fit in what a local model
  can read at once. Work on one section at a time.
- **Codex may not know the model.** For a model it doesn't recognise, Codex
  says it is using fallback settings. Quality can drop; try a model from the
  list above.
- **A server that stops mid-run isn't noticed.** Fenna checks the server
  before a run starts, so a server that isn't running fails at once. If it
  quits while a run is going, the run waits until you press Stop.
