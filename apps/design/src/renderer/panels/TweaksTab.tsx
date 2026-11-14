// The Tweaks tab: the design's variables. A layer that uses var(--accent)
// follows the tweak, so one change here moves every artboard.

import { useState } from "react";
import { Icon, MenuButton, toast } from "@opendeck/shell";
import { removeTweak, renameTweak, setTweak, tweakUsers, useDesign } from "../store.ts";
import { ColorControl } from "./ColorControl.tsx";
import { TextField } from "./Fields.tsx";

const isColor = (v: string) => /^(#|rgb|hsl)/.test(v);

export function TweaksTab() {
  const tweaks = useDesign((s) => s.index.tweaks);
  useDesign((s) => s.boards);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const entries = Object.entries(tweaks);

  const add = () => {
    const key = `--${name.trim().toLowerCase().replace(/^-+/, "").replace(/[^a-z0-9-]+/g, "-")}`;
    if (!/^--[a-z][a-z0-9-]{0,39}$/.test(key)) return toast("A tweak’s name starts with a letter and uses lowercase letters, digits and dashes.");
    if (key in tweaks) return toast(`There is already a tweak called ${key.slice(2)}.`);
    if (setTweak(key, "#888888")) setName("");
  };

  return (
    <div className="pp-scroll pp-tweaks">
      {entries.map(([key, value]) => {
        const users = tweakUsers(key).length;
        return (
          <div key={key} className="pp-tweak">
            {renaming === key ? (
              <TextField
                label="Tweak name"
                value={key.slice(2)}
                onCommit={(v) => {
                  renameTweak(key, `--${v.toLowerCase().replace(/^-+/, "")}`);
                  setRenaming(null);
                }}
              />
            ) : (
              <span className="pp-tweak-name" title={`var(${key}) · used by ${users === 1 ? "1 artboard" : `${users} artboards`}`}>
                {key.slice(2)}
              </span>
            )}
            {isColor(value) ? <ColorControl label={key.slice(2)} value={value} onCommit={(v) => v && setTweak(key, v)} /> : <TextField label={key.slice(2)} value={value} mono onCommit={(v) => v && setTweak(key, v)} />}
            <MenuButton
              className="icon-btn pp-toggle"
              label={`${key.slice(2)} actions`}
              title="More"
              align="end"
              entries={() => [
                { label: "Rename", onSelect: () => setRenaming(key) },
                { label: "Remove", danger: true, hint: users ? `Used by ${users === 1 ? "1 artboard" : `${users} artboards`}` : undefined, onSelect: () => removeTweak(key) },
              ]}
            >
              <Icon name="dots" size={16} />
            </MenuButton>
          </div>
        );
      })}
      {!entries.length && (
        <div className="rp-empty">
          <p>No tweaks yet</p>
          <p className="rp-hint">A tweak is a color or a size with a name. Layers that use it change together.</p>
        </div>
      )}
      <form
        className="pp-tweak-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={name} placeholder="New tweak, like ink" aria-label="New tweak name" maxLength={40} spellCheck={false} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button type="submit" className="btn" disabled={!name.trim()}>
          Add
        </button>
      </form>
      <p className="pp-code-note">Use a tweak from any color field: pick it from the swatch, or type its name.</p>
    </div>
  );
}
