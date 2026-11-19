// A stand-in for Claude Code's stream-json mode, for tests: it reads the
// message on stdin and answers with the events the real CLI prints. What it
// says depends on the message: "fail" exits with an error, "hang" waits to
// be stopped; anything else calls one tool on each server it was given and
// replies with its working folder, the servers and an environment value.
const fs = require("node:fs");

const args = process.argv.slice(2);
const cfgPath = args[args.indexOf("--mcp-config") + 1];
const servers = Object.keys(JSON.parse(fs.readFileSync(cfgPath, "utf8")).mcpServers);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const msg = JSON.parse(input.trim());
  const text = msg.message.content.find((p) => p.type === "text").text;
  out({ type: "system", subtype: "init", session_id: "fake-session" });
  if (text.includes("fail")) {
    process.stderr.write("Error: something broke\n");
    process.exit(3);
  }
  if (text.includes("hang")) {
    setInterval(() => {}, 1000);
    return;
  }
  servers.forEach((s, i) => {
    out({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${i}`, name: `mcp__${s}__look`, input: { n: i } }] } });
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${i}` }] } });
  });
  const prompt = args.includes("--permission-prompt-tool") ? args[args.indexOf("--permission-prompt-tool") + 1] : "none";
  out({ type: "assistant", message: { content: [{ type: "text", text: JSON.stringify({ cwd: process.cwd(), servers, prompt, extra: process.env.FAKE_EXTRA || null, resume: args.includes("--resume") ? args[args.indexOf("--resume") + 1] : null }) }] } });
  out({ type: "result", subtype: "success", session_id: "fake-session" });
});
