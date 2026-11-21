/* Fetches docs/shipped.json from the Fenna repo and renders what the crew shipped.
   Titles and names come from the repo, so they only ever go in as text. */
(function () {
  var RAW = "https://raw.githubusercontent.com/Sidhilynx/fenna/main/docs/shipped.json";
  var FILE = "https://github.com/Sidhilynx/fenna/blob/main/docs/shipped.json";
  var GITHUB = "https://github.com/";
  var LIMIT = 200;
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var container = document.getElementById("shipped");

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function text(value) {
    return typeof value === "string" ? value : "";
  }

  function clear() {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function message(line) {
    clear();
    container.appendChild(el("p", "state", line));
  }

  function fail() {
    clear();
    var p = el("p", "state");
    p.appendChild(document.createTextNode("Couldn't load the list. It lives at "));
    var link = el("a", "link", "docs/shipped.json");
    link.href = FILE;
    p.appendChild(link);
    p.appendChild(document.createTextNode(" in the repo."));
    container.appendChild(p);
  }

  /* Keeps the entries that have a time and a title, newest first, at most LIMIT. */
  function usable(entries) {
    var out = [];
    entries.forEach(function (entry) {
      if (!entry || typeof entry !== "object") return;
      var ms = Date.parse(text(entry.at));
      var title = text(entry.title);
      if (isNaN(ms) || !title) return;
      out.push({ ms: ms, kind: text(entry.kind), title: title, url: text(entry.url), by: text(entry.by) });
    });
    out.sort(function (a, b) { return b.ms - a.ms; });
    return out.slice(0, LIMIT);
  }

  function dayKey(date) {
    return date.getFullYear() * 10000 + date.getMonth() * 100 + date.getDate();
  }

  function dayLabel(date) {
    return date.getDate() + " " + MONTHS[date.getMonth()] + " " + date.getFullYear();
  }

  function row(entry) {
    var p = el("p");
    if (entry.kind) {
      p.appendChild(el("span", "release-date px-label", entry.kind));
      p.appendChild(document.createTextNode(" "));
    }
    if (entry.url.indexOf(GITHUB) === 0) {
      var link = el("a", "link", entry.title);
      link.href = entry.url;
      p.appendChild(link);
    } else {
      p.appendChild(document.createTextNode(entry.title));
    }
    if (entry.by) {
      p.appendChild(document.createTextNode(" "));
      p.appendChild(el("span", "", "by " + entry.by));
    }
    return p;
  }

  function render(entries) {
    if (entries.length === 0) {
      message("Nothing shipped yet.");
      return;
    }
    clear();
    var key = null;
    var body = null;
    entries.forEach(function (entry) {
      var date = new Date(entry.ms);
      if (dayKey(date) !== key) {
        key = dayKey(date);
        var section = el("section", "release");
        var meta = el("div", "release-meta");
        meta.appendChild(el("h3", "", dayLabel(date)));
        body = el("div", "release-body");
        section.appendChild(meta);
        section.appendChild(body);
        container.appendChild(section);
      }
      body.appendChild(row(entry));
    });
  }

  fetch(RAW).then(function (res) {
    if (!res.ok) throw new Error("status " + res.status);
    return res.json();
  }).then(function (data) {
    if (!data || !Array.isArray(data.entries)) throw new Error("shape");
    render(usable(data.entries));
  }).catch(fail);
})();
