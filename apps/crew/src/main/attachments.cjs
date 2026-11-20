// Files a person attaches to a message to a bot. They are saved to the bot's
// Files/Inbox/ before the run starts, the message the bot gets lists each one
// as "Attached: <disk path> (<kind>, <size>)", and the few small images among
// them go to the CLI as pictures on that turn.

const { kindOf, sizeText } = require("./disk.cjs");

const MAX_FILES = 10;
const INLINE_MAX_IMAGES = 5;
const INLINE_MAX_BYTES = 5 * 1024 ** 2;
const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const WORD_KINDS = {
  spreadsheet: ["xlsx", "xls", "xlsm", "ods", "numbers", "csv", "tsv"],
  document: ["docx", "doc", "odt", "rtf", "pages"],
  slides: ["pptx", "ppt", "odp", "key"],
};

const extOf = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** What a file is, in a word for the message: spreadsheet, document, slides, image, pdf, text, and so on. */
function kindWord(name) {
  const ext = extOf(name);
  for (const [word, exts] of Object.entries(WORD_KINDS)) if (exts.includes(ext)) return word;
  const kind = kindOf(name);
  return kind === "other" ? "file" : kind;
}

/** The files of one send, checked: a list of at most 10, each a name and its bytes. The size limit is checked when the files are saved. */
function checkAttachments(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error("The attached files should be a list.");
  if (v.length > MAX_FILES) throw new Error(`You can attach at most ${MAX_FILES} files to a message. Take off ${v.length - MAX_FILES} and send again.`);
  return v.map((f) => {
    if (!f || typeof f !== "object" || typeof f.name !== "string" || !f.name.trim() || !(f.bytes instanceof ArrayBuffer)) {
      throw new Error("An attached file is a name and its bytes.");
    }
    return { name: f.name, bytes: f.bytes };
  });
}

/**
 * The attachments of a saved send, as a run keeps them (`list`, with no bytes, for the run log),
 * and the images the CLI is shown this turn (`images`: the first few small ones, in base64).
 * @param {{ path: string, name: string, size: number, abs: string }[]} saved  from disk.inbox, in the order sent
 * @param {{ name: string, bytes: ArrayBuffer }[]} files  the same files as sent
 */
function forRun(saved, files) {
  const list = saved.map((s) => ({ path: s.path, name: s.name, kind: kindWord(s.name), size: s.size }));
  const images = [];
  saved.forEach((s, i) => {
    const mimeType = IMAGE_MIME[extOf(s.name)];
    if (!mimeType || s.size > INLINE_MAX_BYTES || images.length >= INLINE_MAX_IMAGES) return;
    images.push({ name: s.name, mimeType, path: s.abs, base64: Buffer.from(files[i].bytes).toString("base64") });
  });
  return { list, images };
}

/** The message the bot is sent: the person's words, then one "Attached:" line per file. With no files, the words as they are. */
function messageWith(text, list) {
  if (!list || !list.length) return text;
  const lines = list.map((a) => `Attached: ${a.path} (${a.kind}, ${sizeText(a.size)})`);
  const block = ["Files the person attached, saved on your disk:", ...lines].join("\n");
  return text.trim() ? `${text}\n\n${block}` : block;
}

module.exports = { MAX_FILES, INLINE_MAX_IMAGES, INLINE_MAX_BYTES, IMAGE_MIME, kindWord, checkAttachments, forRun, messageWith };
