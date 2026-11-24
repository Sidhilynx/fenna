// The request the "Make a sticker" box sends to the AI: the words the person
// typed, and where the picture goes. The Ask box carries it to the AI.

export const STICKER_WORDS_MAX = 200;

export function stickerRequest(words: string): string {
  return `Make a sticker of "${words.trim()}". Draw it with the Fenna Whiteboard tools as one small, simple picture in one group, near the middle of the screen. Then reply in one short sentence.`;
}
