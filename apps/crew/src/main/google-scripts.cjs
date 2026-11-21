// Google's sign-in, as far as Crew touches it: the address that opens the
// sign-in page for one account (in the bot's plain Chrome window, where the
// person signs in by hand), and reading Google's list of the accounts a
// Chrome profile is signed in to. Crew never drives the sign-in pages.

/** Google's sign-in page for one account, with its email filled in. */
function signInUrl(email) {
  return `https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmyaccount.google.com%2F&Email=${encodeURIComponent(email)}`;
}

/** The accounts signed in to a Chrome profile, from the body of Google's ListAccounts response. Never throws; [] when the body doesn't parse. */
function parseListAccounts(text) {
  try {
    if (typeof text !== "string") return [];
    const body = text.replace(/^\)\]\}'[^\S\n]*\r?\n?/, "");
    const data = JSON.parse(body);
    if (!Array.isArray(data) || data[0] !== "gaia.l.a.r" || !Array.isArray(data[1])) return [];
    const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const accounts = [];
    for (const entry of data[1]) {
      if (!Array.isArray(entry)) continue;
      const email = entry.find((v) => typeof v === "string" && EMAIL.test(v));
      if (!email) continue;
      const name = typeof entry[2] === "string" && entry[2] ? entry[2] : null;
      accounts.push({ email: email.toLowerCase(), name });
    }
    return accounts;
  } catch {
    return [];
  }
}

module.exports = { signInUrl, parseListAccounts };
