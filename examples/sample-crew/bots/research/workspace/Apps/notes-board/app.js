// Notes: a short list of notes, kept in this app's folder as notes.json.
// The bot adds a note with the add_note tool, which runs here, in the page.

const MAX = 500;
const form = document.getElementById("form");
const input = document.getElementById("text");
const addButton = document.getElementById("add");
const list = document.getElementById("notes");
const empty = document.getElementById("empty");
const count = document.getElementById("count");
const errorLine = document.getElementById("error");

let notes = [];

function showError(message) {
  errorLine.textContent = message;
  errorLine.hidden = !message;
}

function when(at) {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function render() {
  list.textContent = "";
  for (const note of notes) {
    const item = document.createElement("li");
    const body = document.createElement("div");
    body.className = "note-body";
    body.textContent = note.text;
    const time = document.createElement("time");
    time.className = "note-time";
    time.dateTime = note.at;
    time.textContent = when(note.at);
    body.append(time);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete note: ${note.text.slice(0, 40)}`);
    del.addEventListener("click", () => remove(note.id));
    item.append(body, del);
    list.append(item);
  }
  empty.hidden = notes.length > 0;
  count.textContent = notes.length === 1 ? "1 note" : `${notes.length} notes`;
}

async function save() {
  await crew.files.write("notes.json", JSON.stringify(notes, null, 2));
}

async function add(text) {
  const note = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, text, at: new Date().toISOString() };
  notes = [note, ...notes];
  try {
    await save();
  } catch (e) {
    notes = notes.filter((n) => n.id !== note.id);
    render();
    throw e;
  }
  render();
  return note;
}

async function remove(id) {
  notes = notes.filter((n) => n.id !== id);
  try {
    await save();
    showError("");
  } catch (e) {
    showError(`Could not save: ${e.message}`);
  }
  render();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    showError("Write a note first.");
    input.focus();
    return;
  }
  addButton.disabled = true;
  try {
    await add(text);
    input.value = "";
    showError("");
  } catch (e) {
    showError(`Could not save: ${e.message}`);
  } finally {
    addButton.disabled = false;
    input.focus();
  }
});

crew.tools.define("add_note", async (args) => {
  const text = String(args && args.text !== undefined ? args.text : "").trim();
  if (!text) throw new Error("Give the note's text.");
  if (text.length > MAX) throw new Error(`A note can be at most ${MAX} characters.`);
  const note = await add(text);
  return { id: note.id, count: notes.length };
});

async function load() {
  try {
    const parsed = JSON.parse(await crew.files.read("notes.json"));
    notes = Array.isArray(parsed) ? parsed.filter((n) => n && typeof n.text === "string" && typeof n.id === "string") : [];
  } catch {
    notes = [];
  }
  render();
  input.focus();
}

load();
