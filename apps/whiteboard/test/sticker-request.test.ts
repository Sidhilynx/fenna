import { describe, expect, it } from "vitest";
import { stickerRequest } from "../src/renderer/stickerRequest.ts";

describe("stickerRequest", () => {
  it("quotes the words the person typed and asks for a drawn sticker near the middle", () => {
    const text = stickerRequest("a sleepy cat with a coffee");
    expect(text).toContain('Make a sticker of "a sleepy cat with a coffee".');
    expect(text).toContain("near the middle of the screen");
    expect(text).toContain("Fenna Whiteboard tools");
  });

  it("trims the words", () => {
    expect(stickerRequest("  a cat  ")).toContain('"a cat".');
  });

  it("keeps quotes and punctuation as typed", () => {
    expect(stickerRequest('a "big" dog!')).toContain('Make a sticker of "a "big" dog!".');
  });
});
