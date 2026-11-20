import { describe, expect, it } from "vitest";
import { grantCovers, insideFolder, manifestHash, NO_GRANT, parseAppManifest, type AppManifest } from "../src/index.ts";

const GOOD = {
  name: "invoice-tracker",
  title: "Invoice tracker",
  icon: "sheet",
  entry: "index.html",
  description: "Lists unpaid invoices from the Invoices sheet.",
  permissions: { documents: "read", network: ["https://api.frankfurter.app"], bot: true },
  tools: [
    {
      name: "overdue",
      description: "Invoices more than 30 days unpaid, as rows.",
      input: { type: "object", properties: { days: { type: "number" } } },
    },
  ],
};

const text = (v: unknown) => JSON.stringify(v);
const problemsOf = (v: unknown) => parseAppManifest(typeof v === "string" ? v : text(v)).problems;

describe("parseAppManifest: a good manifest", () => {
  it("is accepted with its defaults filled in", () => {
    const r = parseAppManifest(text(GOOD));
    expect(r.problems).toEqual([]);
    expect(r.app).toEqual({
      name: "invoice-tracker",
      title: "Invoice tracker",
      icon: "sheet",
      entry: "index.html",
      description: "Lists unpaid invoices from the Invoices sheet.",
      permissions: { documents: "read", network: ["https://api.frankfurter.app"], bot: true },
      tools: [
        {
          name: "overdue",
          description: "Invoices more than 30 days unpaid, as rows.",
          input: { type: "object", properties: { days: { type: "number" } }, required: [] },
        },
      ],
    });
  });

  it("fills every default when only name and title are given", () => {
    const r = parseAppManifest(text({ name: "notes", title: "Notes" }));
    expect(r.problems).toEqual([]);
    expect(r.app).toEqual({
      name: "notes",
      title: "Notes",
      icon: "app",
      entry: "index.html",
      description: "",
      permissions: NO_GRANT,
      tools: [],
    });
  });

  it("trims the title and description", () => {
    const r = parseAppManifest(text({ name: "notes", title: "  Notes  ", description: "  A board. " }));
    expect(r.app?.title).toBe("Notes");
    expect(r.app?.description).toBe("A board.");
  });
});

describe("parseAppManifest: the file itself", () => {
  it("says when the text is not JSON", () => {
    const r = parseAppManifest("{ name: notes");
    expect(r.app).toBeNull();
    expect(r.problems[0]).toMatch(/^app\.json is not valid JSON \(/);
  });

  it("wants one object, not a list or a string", () => {
    expect(problemsOf([])).toEqual([expect.stringContaining("one JSON object")]);
    expect(problemsOf("\"notes\"")).toEqual([expect.stringContaining("one JSON object")]);
    expect(problemsOf("null")).toEqual([expect.stringContaining("one JSON object")]);
  });

  it("names a field it does not know, with the ones it does", () => {
    const p = problemsOf({ name: "notes", title: "Notes", tittle: "x" });
    expect(p).toEqual(['"tittle" isn\'t a field of app.json. Use name, title, icon, entry, description, permissions, tools.']);
  });
});

describe("name, title, icon, description", () => {
  it.each(["Notes", "1notes", "notes_board", "-notes", "a".repeat(33), ""])("rejects the name %j", (name) => {
    const p = problemsOf({ name, title: "Notes" });
    expect(p.length).toBe(1);
    expect(p[0]).toMatch(/^name is /);
    expect(p[0]).toContain("Use lowercase letters, digits and dashes");
  });

  it("accepts the longest name", () => {
    expect(problemsOf({ name: `a${"b".repeat(31)}`, title: "Notes" })).toEqual([]);
  });

  it("asks for a name when there is none", () => {
    expect(problemsOf({ title: "Notes" })[0]).toBe("name is missing. Use lowercase letters, digits and dashes, starting with a letter, up to 32 characters, like invoice-tracker.");
  });

  it("needs a title, at most 60 characters", () => {
    expect(problemsOf({ name: "notes" })).toEqual(['title is missing. Say what the app is called, like "Invoice tracker".']);
    expect(problemsOf({ name: "notes", title: "   " })).toEqual([expect.stringContaining("title is missing")]);
    expect(problemsOf({ name: "notes", title: "x".repeat(61) })).toEqual(["title is 61 characters. The most is 60."]);
  });

  it("checks the icon name when one is given", () => {
    expect(problemsOf({ name: "notes", title: "Notes", icon: "Sheet" })[0]).toBe(
      'icon is "Sheet". Use the name of one of Crew\'s icons, like sheet, doc or board, or leave it out.',
    );
    expect(problemsOf({ name: "notes", title: "Notes", icon: 3 })[0]).toMatch(/^icon is 3\./);
  });

  it("limits the description to 300 characters", () => {
    expect(problemsOf({ name: "notes", title: "Notes", description: "x".repeat(301) })).toEqual([
      "description must be text of at most 300 characters.",
    ]);
    expect(problemsOf({ name: "notes", title: "Notes", description: "x".repeat(300) })).toEqual([]);
  });
});

describe("entry: a path inside the app's folder", () => {
  it.each([
    ["/index.html", "absolute"],
    ["\\index.html", "backslash"],
    ["C:/index.html", "drive"],
    ["../index.html", "parent"],
    ["pages/../index.html", "parent inside"],
    ["pages//home.html", "empty part"],
    ["./index.html", "dot part"],
    ["", "empty"],
  ])("refuses %j (%s)", (entry) => {
    const p = problemsOf({ name: "notes", title: "Notes", entry });
    expect(p).toEqual([expect.stringMatching(/^entry is .*Use a relative path inside the app's folder/)]);
  });

  it("accepts nested relative paths", () => {
    expect(problemsOf({ name: "notes", title: "Notes", entry: "pages/home.html" })).toEqual([]);
  });

  it("refuses a non-text entry", () => {
    expect(problemsOf({ name: "notes", title: "Notes", entry: 1 })[0]).toBe(
      "entry is 1. Use a relative path inside the app's folder, like index.html or pages/home.html.",
    );
  });
});

describe("permissions", () => {
  const withPerms = (permissions: unknown) => problemsOf({ name: "notes", title: "Notes", permissions });

  it("defaults to nothing: no documents, no network, no bot", () => {
    expect(parseAppManifest(text({ name: "notes", title: "Notes" })).app?.permissions).toEqual({ documents: "none", network: [], bot: false });
  });

  it("names the allowed values for documents", () => {
    expect(withPerms({ documents: "readwrite" })).toEqual(['permissions.documents is "readwrite". Use none, read or write.']);
    expect(withPerms({ documents: "write" })).toEqual([]);
  });

  it("names the permission that does not exist", () => {
    expect(withPerms({ camera: true })).toEqual(["permissions.camera isn't a permission. Use documents, network, bot."]);
  });

  it("wants bot to be true or false", () => {
    expect(withPerms({ bot: "yes" })).toEqual(['permissions.bot is "yes". Use true or false.']);
  });

  it("needs permissions to be an object", () => {
    expect(withPerms(["read"])[0]).toMatch(/^permissions is \["read"\]\. Write it as an object/);
  });

  it.each([
    "https://api.example.com",
    "http://localhost:8080",
    "https://api.example.com:8443",
  ])("accepts the exact origin %s", (o) => {
    expect(withPerms({ network: [o] })).toEqual([]);
  });

  it.each([
    ["https://api.example.com/", "a trailing slash"],
    ["https://api.example.com/v1", "a path"],
    ["https://api.example.com?x=1", "a query"],
    ["https://api.example.com:443", "a default port"],
    ["HTTPS://API.example.com", "a capital scheme"],
    ["ftp://files.example.com", "another scheme"],
    ["https://user@api.example.com", "a user name"],
    ["api.example.com", "no scheme"],
    ["*", "a wildcard"],
  ])("refuses %j (%s)", (o) => {
    expect(withPerms({ network: [o] })[0]).toMatch(/^permissions\.network\[0\] is ".*"\. Write just the origin: https:\/\/host or https:\/\/host:port, with no path or slash\.$/);
  });

  it("allows at most 10 origins", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `https://h${i}.example.com`);
    expect(withPerms({ network: eleven })).toEqual(["permissions.network has 11 origins. The most is 10."]);
    expect(withPerms({ network: eleven.slice(0, 10) })).toEqual([]);
  });

  it("needs network to be a list", () => {
    expect(withPerms({ network: "https://api.example.com" })[0]).toMatch(/^permissions\.network is "https:\/\/api\.example\.com"\. Write a list/);
  });

  it("drops a repeated origin", () => {
    const r = parseAppManifest(text({ name: "notes", title: "Notes", permissions: { network: ["https://a.example.com", "https://a.example.com"] } }));
    expect(r.app?.permissions.network).toEqual(["https://a.example.com"]);
  });
});

describe("tools", () => {
  const tool = (t: unknown) => problemsOf({ name: "notes", title: "Notes", tools: [t] });
  const okTool = { name: "add_note", description: "Adds a note.", input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } };

  it("accepts a good tool", () => {
    expect(tool(okTool)).toEqual([]);
  });

  it("allows at most 20 tools", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `t${i}`, description: "x" }));
    expect(problemsOf({ name: "notes", title: "Notes", tools: many(21) })).toEqual(["tools has 21 tools. The most is 20."]);
    expect(problemsOf({ name: "notes", title: "Notes", tools: many(20) })).toEqual([]);
  });

  it.each(["Add", "1add", "add-note", "a".repeat(41), ""])("rejects the tool name %j", (name) => {
    expect(tool({ ...okTool, name })[0]).toMatch(/^tools\[0\]\.name is .*Use lowercase letters, digits and underscores/);
  });

  it("refuses two tools with one name", () => {
    expect(problemsOf({ name: "notes", title: "Notes", tools: [okTool, okTool] })).toEqual(['tools[1].name "add_note" is already a tool. Give each tool its own name.']);
  });

  it("needs a description of 1 to 300 characters", () => {
    expect(tool({ ...okTool, description: "  " })[0]).toMatch(/^tools\[0\]\.description must be one to 300 characters/);
    expect(tool({ ...okTool, description: "x".repeat(301) })[0]).toMatch(/^tools\[0\]\.description must be/);
  });

  it("wants its input to be an object schema of type object", () => {
    expect(tool({ ...okTool, input: { type: "array" } })[0]).toBe(
      'tools[0].input.type is "array". A tool\'s input is an object: use "type": "object".',
    );
    expect(tool({ ...okTool, input: [] })[0]).toMatch(/^tools\[0\]\.input is \[\]\. Write a JSON Schema object/);
  });

  it("defaults the input to an object with no properties", () => {
    const r = parseAppManifest(text({ name: "notes", title: "Notes", tools: [{ name: "now", description: "The time." }] }));
    expect(r.app?.tools[0].input).toEqual({ type: "object", properties: {}, required: [] });
  });

  it.each(["string", "number", "boolean", "array", "object"])("allows the property type %s", (type) => {
    expect(tool({ ...okTool, input: { type: "object", properties: { p: { type } } } })).toEqual([]);
  });

  it("names the property types that are allowed", () => {
    expect(tool({ ...okTool, input: { type: "object", properties: { days: { type: "integer" } } } })).toEqual([
      'tools[0].input.properties.days.type is "integer". Use string, number, boolean, array or object.',
    ]);
  });

  it("says a property must be an object with a type", () => {
    expect(tool({ ...okTool, input: { type: "object", properties: { days: "number" } } })[0]).toMatch(/^tools\[0\]\.input\.properties\.days is "number"\./);
  });

  it("needs required to name properties that exist", () => {
    expect(tool({ ...okTool, input: { type: "object", properties: {}, required: ["text"] } })).toEqual([
      'tools[0].input.required names "text", which isn\'t a property. Add it to properties or take it out of required.',
    ]);
  });

  it("refuses a tool field it does not know", () => {
    expect(tool({ ...okTool, run: "x" })).toEqual(["tools[0].run isn't a tool field. Use name, description or input."]);
  });

  it("refuses a tool that is not an object", () => {
    expect(tool("add")[0]).toMatch(/^tools\[0\] is "add"\. Write it as an object/);
  });

  it("needs tools to be a list", () => {
    expect(problemsOf({ name: "notes", title: "Notes", tools: {} })[0]).toMatch(/^tools is \{\}\./);
  });
});

describe("insideFolder", () => {
  it.each(["index.html", "a/b/c.js", "pages/home.html"])("accepts %s", (p) => expect(insideFolder(p)).toBe(true));
  it.each(["", "/a", "\\a", "a\\b", "C:a", "a/../b", "a//b", "./a", "a/."])("refuses %j", (p) => expect(insideFolder(p)).toBe(false));
});

describe("grantCovers", () => {
  const manifest = parseAppManifest(text(GOOD)).app as AppManifest;

  it("covers what the manifest asks for", () => {
    expect(grantCovers(manifest.permissions, manifest)).toBe(true);
  });

  it("does not cover an app with no grant when it asks for something", () => {
    expect(grantCovers(NO_GRANT, manifest)).toBe(false);
  });

  it("covers nothing extra for an app that asks for nothing", () => {
    const plain = parseAppManifest(text({ name: "notes", title: "Notes" })).app as AppManifest;
    expect(grantCovers(NO_GRANT, plain)).toBe(true);
  });

  it("needs documents at least as high as asked", () => {
    expect(grantCovers({ ...manifest.permissions, documents: "none" }, manifest)).toBe(false);
    expect(grantCovers({ ...manifest.permissions, documents: "write" }, manifest)).toBe(true);
    const writer = { ...manifest, permissions: { ...manifest.permissions, documents: "write" as const } };
    expect(grantCovers({ ...manifest.permissions, documents: "read" }, writer)).toBe(false);
  });

  it("needs every asked origin", () => {
    const more = { ...manifest, permissions: { ...manifest.permissions, network: ["https://api.frankfurter.app", "https://x.example.com"] } };
    expect(grantCovers(manifest.permissions, more)).toBe(false);
    expect(grantCovers({ ...manifest.permissions, network: [...more.permissions.network] }, more)).toBe(true);
  });

  it("needs the bot if asked", () => {
    expect(grantCovers({ ...manifest.permissions, bot: false }, manifest)).toBe(false);
  });
});

describe("manifestHash", () => {
  const manifest = parseAppManifest(text(GOOD)).app as AppManifest;

  it("is the same for the same manifest, whatever the key order", () => {
    const reordered = parseAppManifest(
      text({ tools: GOOD.tools, permissions: GOOD.permissions, description: GOOD.description, entry: "index.html", icon: "sheet", title: GOOD.title, name: GOOD.name }),
    ).app as AppManifest;
    expect(manifestHash(reordered)).toBe(manifestHash(manifest));
  });

  it("changes when a permission changes", () => {
    const wider = { ...manifest, permissions: { ...manifest.permissions, bot: false } };
    expect(manifestHash(wider)).not.toBe(manifestHash(manifest));
  });

  it("is a 16 character hex text", () => {
    expect(manifestHash(manifest)).toMatch(/^[0-9a-f]{16}$/);
  });
});
