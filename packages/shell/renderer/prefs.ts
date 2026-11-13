// Small per-computer preferences (a panel left open, a checkbox left ticked).
// They are a convenience: if storage is unavailable the defaults apply.

export function readPref(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(`od.${key}`);
    return v === null ? dflt : v === "1";
  } catch {
    return dflt;
  }
}

export function writePref(key: string, v: boolean) {
  try {
    localStorage.setItem(`od.${key}`, v ? "1" : "0");
  } catch {
    /* preferences are a convenience */
  }
}
