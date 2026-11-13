/* The window's tab strip, shared by every app on the shell (after Arsaze's). Vanilla, no build step, no network. */
(function () {
  "use strict";

  const EASE = "cubic-bezier(.2,.8,.2,1)";
  const DWELL = 450;
  const WARM = 300;
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const barEl = $("bar");
  const scroller = $("scroller");
  const tabsEl = $("tabs");
  const cardEl = $("card");
  const cTitle = cardEl.querySelector(".c-title");
  const cMeta = cardEl.querySelector(".c-meta");
  const cThumb = cardEl.querySelector(".c-thumb");
  const cImg = cThumb.querySelector("img");
  const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ms = (n) => (reduceMq.matches ? 0 : n);
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const delay = (n) => new Promise((r) => setTimeout(r, n));
  const api = window.shellStrip;

  /* ---------- icons: the shell's own glyphs (glyphs.js) ---------- */
  const G = window.STRIP_GLYPHS;
  /** Same rule as the renderer's Icon: about 1.6px of stroke at any size. */
  const strokeFor = (size) => Math.round((((size >= 18 ? 1.65 : size >= 15 ? 1.6 : size >= 13 ? 1.5 : 1.4) * 20) / size) * 100) / 100;
  const svg = (g, size) =>
    '<svg viewBox="0 0 20 20" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="' + strokeFor(size) +
    '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (g.t ? '<path d="' + g.t + '" fill="currentColor" fill-opacity="0.2" stroke="none"/>' : "") +
    (g.s ? '<path d="' + g.s + '"/>' : "") +
    (g.f ? '<path d="' + g.f + '" fill="currentColor" stroke="none"/>' : "") +
    "</svg>";
  $("plus").innerHTML = svg(G.plus, 16);
  $("list").innerHTML = svg(G.chevron, 16);

  /* ---------- state ---------- */
  let state = null;
  let initialized = false;
  const recs = new Map(); // id -> rec
  let lastRaw = null;
  let optTab = null; // {rec, t}
  let optSeq = 0;
  let lastPrefetch = -1e9;
  let optimistic = null; // {id, t}
  let pendingMove = null; // {id, toIndex, t}
  let press = null;
  let pointerInside = false;
  let frozen = false;
  let unfreezeT = 0;

  const liveRecs = () => {
    const out = [];
    for (const el of tabsEl.children) {
      if (el.classList.contains("closing")) continue;
      const r = recs.get(el.dataset.id);
      if (r) out.push(r);
    }
    return out;
  };

  function anim(el, frames, dur, opts) {
    if (!dur) return null;
    try {
      return el.animate(frames, Object.assign({ duration: dur, easing: EASE }, opts || {}));
    } catch (_) {
      return null;
    }
  }

  /* ---------- tab creation / update ---------- */
  // The close button hides on tabs narrower than 96px (unless active).
  const narrowRo = new ResizeObserver((entries) => {
    for (const en of entries) en.target.classList.toggle("narrow", en.target.getBoundingClientRect().width < 96);
  });
  function newTabOptimistic() {
    if (optTab || (press && press.dragging) || !initialized) { api.newTab(); return; }
    const t = { id: "opt-" + ++optSeq, title: "New tab", kind: "home", loading: true, state: "idle", label: null, path: "" };
    const rec = createTab(t);
    rec.placeholder = true;
    recs.set(t.id, rec);
    if (frozen) unfreeze(false);
    tabsEl.appendChild(rec.el);
    optTab = { rec, t: performance.now() };
    if (state) state = Object.assign({}, state, { activeId: t.id });
    setActiveClass(t.id);
    updateTab(rec, t);
    openAnim(rec);
    api.newTab();
    setTimeout(() => { if (optTab && optTab.rec === rec && lastRaw) render(lastRaw); }, 2100);
  }
  function adoptOptTab(nid) {
    const rec = optTab.rec;
    optTab = null;
    recs.delete(rec.id);
    rec.id = nid;
    rec.placeholder = false;
    rec.el.dataset.id = nid;
    recs.set(nid, rec);
  }
  function dropOptTab() {
    const rec = optTab.rec;
    optTab = null;
    removeTab(rec);
    if (lastRaw) state = lastRaw;
  }

  function createTab(t) {
    const el = document.createElement("div");
    el.className = "tab";
    el.setAttribute("role", "tab");
    el.dataset.id = t.id;
    const bg = document.createElement("span");
    bg.className = "bg";
    bg.setAttribute("aria-hidden", "true");
    const ico = document.createElement("span");
    ico.className = "ico";
    const title = document.createElement("span");
    title.className = "title";
    const close = document.createElement("button");
    close.className = "close";
    close.type = "button";
    close.tabIndex = -1;
    close.innerHTML = svg(G.x, 12);
    el.append(bg, ico, title, close);
    narrowRo.observe(el);
    const rec = { id: t.id, el, ico, title, close, tab: t, last: {}, iconKey: "" };

    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".close")) return;
      hideCard(true);
      if (rec.placeholder) return;
      if (!state || state.activeId !== rec.id) {
        optimistic = { id: rec.id, t: performance.now() };
        setActiveClass(rec.id);
        api.activate(rec.id);
      }
      press = { rec, startX: e.clientX, lastX: e.clientX, pid: e.pointerId, dragging: false, raf: 0 };
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* the pointer left already */ }
    });
    el.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        if (!rec.placeholder) api.close(rec.id);
      }
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      hideCard(true);
      if (!rec.placeholder) api.menu(rec.id, Math.round(e.clientX), Math.round(e.clientY));
    });
    el.addEventListener("pointerenter", () => onTabEnter(rec));
    el.addEventListener("pointerleave", () => onTabLeave(rec));
    close.addEventListener("pointerdown", (e) => e.stopPropagation());
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!rec.placeholder) api.close(rec.id);
    });
    return rec;
  }

  function iconKey(t) {
    if (t.state === "working") return "spin";
    if (t.state === "done") return "dot";
    if (t.loading) return "load";
    return "kind:" + (G[t.kind] ? t.kind : "doc");
  }

  function setIcon(rec, t) {
    const key = iconKey(t);
    if (key === rec.iconKey) return;
    rec.iconKey = key;
    if (key === "dot") rec.ico.innerHTML = '<span class="dot"></span>';
    else if (key === "spin") rec.ico.innerHTML = '<span class="spin"></span>';
    else if (key === "load") rec.ico.innerHTML = '<span class="spin light"></span>';
    else rec.ico.innerHTML = svg(G[key.slice(5)], 16);
  }

  function statusText(t) {
    if (t.state === "working") return "Assistant working" + (t.label ? ": " + t.label : "");
    if (t.state === "done") return "Assistant finished";
    if (t.loading) return "Loading";
    return "";
  }
  function metaLine(t) {
    const s = statusText(t);
    if (s) return t.kindName + " · " + s;
    return t.path || t.kindName;
  }

  function updateTab(rec, t) {
    const l = rec.last;
    rec.tab = t;
    const el = rec.el;
    const active = state.activeId === t.id;
    if (l.title !== t.title) {
      l.title = t.title;
      rec.title.textContent = t.title;
      rec.close.setAttribute("aria-label", "Close " + t.title);
    }
    const aria = t.title + (statusText(t) ? ", " + statusText(t) : "");
    if (l.aria !== aria) { l.aria = aria; el.setAttribute("aria-label", aria); }
    if (l.active !== active) {
      l.active = active;
      el.classList.toggle("active", active);
      el.setAttribute("aria-selected", active ? "true" : "false");
      el.tabIndex = active ? 0 : -1;
    }
    setIcon(rec, t);
  }

  function setActiveClass(id) {
    for (const r of recs.values()) {
      const a = r.id === id;
      if (r.last.active === a) continue;
      r.last.active = a;
      r.el.classList.toggle("active", a);
      r.el.setAttribute("aria-selected", a ? "true" : "false");
      r.el.tabIndex = a ? 0 : -1;
    }
  }

  /* ---------- theme / platform ---------- */
  function applyChrome(s) {
    if (root.dataset.platform !== s.platform) root.dataset.platform = s.platform;
    const mode = s.theme && s.theme.mode === "light" ? "light" : "dark";
    if (root.dataset.theme !== mode) root.dataset.theme = mode;
    const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : null);
    const bar = s.theme && hex(s.theme.bar);
    const strip = s.theme && hex(s.theme.strip);
    if (bar) root.style.setProperty("--bar", bar);
    else root.style.removeProperty("--bar");
    if (strip) root.style.setProperty("--strip", strip);
    else root.style.removeProperty("--strip");
    root.dataset.fullscreen = s.fullscreen ? "true" : "false";
    root.dataset.focused = s.focused === false ? "false" : "true";
  }

  /* ---------- render (diff by id) ---------- */
  function render(s) {
    if (!s || !Array.isArray(s.tabs)) return;
    lastRaw = s;
    if (optTab) {
      const nid = s.tabs.map((t) => t.id).find((id) => !recs.has(id));
      if (nid) adoptOptTab(nid);
      else if (performance.now() - optTab.t > 2000) dropOptTab();
      else {
        s = Object.assign({}, s, { tabs: s.tabs.concat([optTab.rec.tab]), activeId: optTab.rec.id });
        optimistic = null;
      }
    }
    if (optimistic) {
      if (s.activeId === optimistic.id || performance.now() - optimistic.t > 250) optimistic = null;
      else s = Object.assign({}, s, { activeId: optimistic.id });
    }
    const prevActive = state && state.activeId;
    state = s;
    applyChrome(s);

    let ids = s.tabs.map((t) => t.id);
    if (pendingMove) {
      if (performance.now() - pendingMove.t > 600 || !ids.includes(pendingMove.id)) pendingMove = null;
      else {
        const want = ids.filter((x) => x !== pendingMove.id);
        want.splice(clamp(pendingMove.toIndex, 0, want.length), 0, pendingMove.id);
        if (want.join("|") === ids.join("|")) pendingMove = null;
        else ids = want;
      }
    }
    const byId = new Map(s.tabs.map((t) => [t.id, t]));
    const idSet = new Set(ids);
    const removed = [...recs.values()].filter((r) => !idSet.has(r.id));
    const added = ids.filter((id) => !recs.has(id));

    if (press && press.dragging && (removed.length || added.length)) cancelDrag();
    const dragging = !!(press && press.dragging);

    // FLIP baseline for a pure remote reorder
    const pure = initialized && !removed.length && !added.length && !dragging;
    const before = pure ? new Map(liveRecs().map((r) => [r.id, r.el.getBoundingClientRect().left])) : null;

    if (frozen && added.length) unfreeze(false);
    if (removed.length && pointerInside && !frozen) freeze();
    for (const r of removed) removeTab(r);

    const fresh = [];
    for (const id of ids) {
      if (recs.has(id)) continue;
      const r = createTab(byId.get(id));
      recs.set(id, r);
      fresh.push(r);
    }
    if (!dragging) {
      let cursor = tabsEl.firstElementChild;
      for (const id of ids) {
        const el = recs.get(id).el;
        while (cursor && cursor.classList.contains("closing")) cursor = cursor.nextElementSibling;
        if (cursor === el) cursor = cursor.nextElementSibling;
        else tabsEl.insertBefore(el, cursor);
      }
    }
    for (const id of ids) updateTab(recs.get(id), byId.get(id));

    if (before) {
      for (const r of liveRecs()) {
        const d = before.get(r.id) - r.el.getBoundingClientRect().left;
        if (Math.abs(d) > 0.5) anim(r.el, [{ transform: "translate3d(" + d + "px,0,0)" }, { transform: "none" }], ms(150));
      }
    }
    if (initialized && fresh.length === 1) openAnim(fresh[0]);
    initialized = true;
    requestAnimationFrame(updateFades);
    if (state.activeId !== prevActive || fresh.length) {
      const r = recs.get(state.activeId);
      if (r && (!fresh.includes(r) || ms(1) === 0 || fresh.length > 1)) ensureVisible(r.el);
    }
    if (cardId && recs.has(cardId) && cardShown) {
      fillCard(recs.get(cardId).tab, cImg.getAttribute("src") ? cImg.src : null);
      resizeOverlay();
    } else if (cardId && !recs.has(cardId)) hideCard(true);
  }

  function openAnim(rec) {
    rec.el.classList.add("anim");
    const a = anim(rec.el, [
      { flexBasis: "0px", minWidth: "0px", opacity: 0, transform: "scale(.96)" },
      { flexBasis: "200px", minWidth: "72px", opacity: 1, transform: "scale(1)" },
    ], ms(180));
    const done = () => { rec.el.classList.remove("anim"); updateFades(); if (state && state.activeId === rec.id) ensureVisible(rec.el); };
    if (a) { a.onfinish = done; a.oncancel = done; } else done();
  }

  function removeTab(rec) {
    recs.delete(rec.id);
    if (cardId === rec.id) hideCard(true);
    if (hoverId === rec.id) hoverId = null;
    const el = rec.el;
    narrowRo.unobserve(el);
    el.classList.add("closing");
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;
    const w = el.getBoundingClientRect().width;
    const a = anim(el, [
      { flexBasis: w + "px", minWidth: w + "px", opacity: 1, transform: "scale(1)" },
      { flexBasis: "0px", minWidth: "0px", opacity: 0, transform: "scale(.96)" },
    ], ms(160), { fill: "forwards" });
    const done = () => { el.remove(); requestAnimationFrame(updateFades); };
    if (a) { a.onfinish = done; a.oncancel = done; } else done();
  }

  /* ---------- widths hold still while closing tabs under the pointer ---------- */
  function freeze() {
    const live = liveRecs();
    const ws = live.map((r) => r.el.getBoundingClientRect().width);
    live.forEach((r, i) => {
      r.el.style.flex = "0 0 " + ws[i] + "px";
      r.el.style.minWidth = ws[i] + "px";
    });
    frozen = true;
  }
  function unfreeze(animated) {
    clearTimeout(unfreezeT);
    if (!frozen) return;
    const live = liveRecs();
    const before = live.map((r) => r.el.getBoundingClientRect().width);
    live.forEach((r) => { r.el.style.flex = ""; r.el.style.minWidth = ""; });
    frozen = false;
    if (!animated || !ms(1)) { requestAnimationFrame(updateFades); return; }
    live.forEach((r, i) => {
      const nw = r.el.getBoundingClientRect().width;
      if (Math.abs(nw - before[i]) < 0.5) return;
      r.el.classList.add("anim");
      const a = anim(r.el, [
        { flexBasis: before[i] + "px", minWidth: before[i] + "px", flexShrink: 0 },
        { flexBasis: nw + "px", minWidth: nw + "px", flexShrink: 0 },
      ], 200);
      const done = () => { r.el.classList.remove("anim"); updateFades(); };
      if (a) { a.onfinish = done; a.oncancel = done; } else done();
    });
  }
  barEl.addEventListener("pointerenter", () => {
    pointerInside = true;
    clearTimeout(unfreezeT);
    const now = performance.now();
    if (now - lastPrefetch >= 2000) { lastPrefetch = now; api.prefetch(); }
  });
  function barLeft() {
    pointerInside = false;
    hideCard(false);
    if (frozen && !(press && press.dragging)) {
      clearTimeout(unfreezeT);
      unfreezeT = setTimeout(() => { if (!pointerInside) unfreeze(true); }, 200);
    }
  }
  barEl.addEventListener("pointerleave", barLeft);
  document.addEventListener("mouseleave", barLeft);
  window.addEventListener("blur", () => { pointerInside = false; hideCard(true); if (frozen) unfreeze(true); });

  /* ---------- overflow: fades, wheel, reveal ---------- */
  function updateFades() {
    const max = scroller.scrollWidth - scroller.clientWidth;
    scroller.style.setProperty("--fl", scroller.scrollLeft > 1 ? "16px" : "0px");
    scroller.style.setProperty("--fr", max > 1 && scroller.scrollLeft < max - 1 ? "16px" : "0px");
  }
  scroller.addEventListener("scroll", updateFades, { passive: true });
  scroller.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      scroller.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
  new ResizeObserver(updateFades).observe(scroller);

  function ensureVisible(el) {
    const pad = 20;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    const v0 = scroller.scrollLeft;
    const v1 = v0 + scroller.clientWidth;
    let to = null;
    if (left - pad < v0) to = Math.max(0, left - pad);
    else if (right + pad > v1) to = right + pad - scroller.clientWidth;
    if (to !== null) scroller.scrollTo({ left: to, behavior: reduceMq.matches ? "auto" : "smooth" });
  }

  /* ---------- drag to reorder ---------- */
  function beginDrag() {
    const p = press;
    const live = liveRecs();
    const i = live.indexOf(p.rec);
    if (i < 0) { press = null; return; }
    hideCard(true);
    if (frozen) unfreeze(false);
    clearTimeout(unfreezeT);
    p.dragging = true;
    p.items = live.map((r) => ({ rec: r, left: r.el.offsetLeft, w: r.el.offsetWidth }));
    p.i = i; p.j = i;
    p.startScroll = scroller.scrollLeft;
    p.lo = 0; p.hi = live.length - 1;
    const it = p.items[i];
    p.minLeft = p.items[0].left;
    p.maxLeft = p.items[p.hi].left + p.items[p.hi].w - it.w;
    document.body.classList.add("dragging");
    live.forEach((r) => { if (r !== p.rec) r.el.classList.add("shift"); });
    p.rec.el.classList.add("drag");
    dragLoop();
  }

  function dragUpdate() {
    const p = press;
    if (!p || !p.dragging) return;
    const it = p.items[p.i];
    const dx = p.lastX - p.startX + (scroller.scrollLeft - p.startScroll);
    let left = it.left + dx;
    const vmin = scroller.scrollLeft;
    const vmax = scroller.scrollLeft + scroller.clientWidth - it.w;
    if (vmax >= vmin) left = clamp(left, vmin, vmax);
    left = clamp(left, p.minLeft, Math.max(p.minLeft, p.maxLeft));
    p.rec.el.style.transform = "translate3d(" + (left - it.left) + "px,0,0)";
    // Swap once the leading edge crosses a neighbour's middle, with a little slack back.
    const right = left + it.w;
    const HYST = 6;
    let j = p.i;
    for (let k = p.i + 1; k <= p.hi; k++) {
      const mid = p.items[k].left + p.items[k].w / 2 - (k <= p.j ? HYST : 0);
      if (right > mid) j = k; else break;
    }
    if (j === p.i) {
      for (let k = p.i - 1; k >= p.lo; k--) {
        const mid = p.items[k].left + p.items[k].w / 2 + (k >= p.j ? HYST : 0);
        if (left < mid) j = k; else break;
      }
    }
    if (j !== p.j) {
      p.j = j;
      const shift = it.w + 2;
      p.items.forEach((o, k) => {
        if (k === p.i) return;
        let x = 0;
        if (p.i < j && k > p.i && k <= j) x = -shift;
        else if (j < p.i && k >= j && k < p.i) x = shift;
        o.rec.el.style.transform = x ? "translate3d(" + x + "px,0,0)" : "";
      });
    }
  }

  function dragLoop() {
    const p = press;
    if (!p || !p.dragging) return;
    const r = scroller.getBoundingClientRect();
    const ZONE = 40;
    let v = 0;
    if (scroller.scrollWidth > scroller.clientWidth + 1) {
      const inL = (r.left + ZONE - p.lastX) / ZONE;
      const inR = (p.lastX - (r.right - ZONE)) / ZONE;
      if (inL > 0) v = -(2 + 16 * Math.min(1, inL) ** 2);
      else if (inR > 0) v = 2 + 16 * Math.min(1, inR) ** 2;
    }
    if (v) scroller.scrollLeft += v;
    dragUpdate();
    p.raf = requestAnimationFrame(dragLoop);
  }

  function cancelDrag() {
    const p = press;
    if (!p) return;
    cancelAnimationFrame(p.raf);
    if (p.dragging) {
      document.body.classList.remove("dragging");
      for (const r of liveRecs()) { r.el.classList.remove("shift"); r.el.style.transform = ""; }
      p.rec.el.classList.remove("drag");
    }
    try { p.rec.el.releasePointerCapture(p.pid); } catch (_) { /* already released */ }
    press = null;
  }

  function endDrag(commit) {
    const p = press;
    if (!p) return;
    press = null;
    cancelAnimationFrame(p.raf);
    try { p.rec.el.releasePointerCapture(p.pid); } catch (_) { /* already released */ }
    if (!p.dragging) { if (commit) api.focusPage(); return; }
    const live = p.items.map((o) => o.rec).filter((r) => recs.get(r.id) === r);
    const j = commit ? p.j : p.i;
    const before = live.map((r) => r.el.getBoundingClientRect().left);
    live.forEach((r) => { r.el.style.transition = "none"; });
    document.body.classList.remove("dragging");
    live.forEach((r) => { r.el.classList.remove("shift"); r.el.style.transform = ""; });
    const movedTo = j !== p.i;
    if (movedTo) {
      const rest = live.filter((r) => r !== p.rec);
      tabsEl.insertBefore(p.rec.el, rest[j] ? rest[j].el : null);
      pendingMove = { id: p.rec.id, toIndex: j, t: performance.now() };
    }
    live.forEach((r, k) => {
      const d = before[k] - r.el.getBoundingClientRect().left;
      if (r === p.rec) {
        const a = d ? anim(r.el, [{ transform: "translate3d(" + d + "px,0,0)" }, { transform: "none" }], ms(160)) : null;
        let fired = false;
        const fin = () => {
          if (fired) return;
          fired = true;
          r.el.classList.remove("drag");
          if (movedTo) api.move(p.rec.id, j);
          if (commit) api.focusPage();
        };
        if (a) { a.onfinish = fin; a.oncancel = fin; } else fin();
      } else if (d) anim(r.el, [{ transform: "translate3d(" + d + "px,0,0)" }, { transform: "none" }], ms(180));
    });
    requestAnimationFrame(() => live.forEach((r) => { r.el.style.transition = ""; }));
    ensureVisible(p.rec.el);
  }

  tabsEl.addEventListener("pointermove", (e) => {
    const p = press;
    if (!p || e.pointerId !== p.pid) return;
    p.lastX = e.clientX;
    if (!p.dragging) {
      if (Math.abs(e.clientX - p.startX) < 5) return;
      beginDrag();
    }
  });
  tabsEl.addEventListener("pointerup", (e) => { if (press && e.pointerId === press.pid) endDrag(true); });
  tabsEl.addEventListener("pointercancel", (e) => { if (press && e.pointerId === press.pid) endDrag(false); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && press && press.dragging) endDrag(false); });

  /* ---------- keyboard ---------- */
  tabsEl.addEventListener("keydown", (e) => {
    const el = e.target.closest && e.target.closest(".tab");
    if (!el) return;
    const live = liveRecs();
    const i = live.findIndex((r) => r.el === el);
    if (i < 0) return;
    const go = (k) => { e.preventDefault(); const r = live[clamp(k, 0, live.length - 1)]; if (r) r.el.focus(); };
    if (e.key === "ArrowRight") go(i + 1);
    else if (e.key === "ArrowLeft") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(live.length - 1);
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!live[i].placeholder) { api.activate(live[i].id); api.focusPage(); } }
    else if (e.key === "Delete") { e.preventDefault(); api.close(live[i].id); }
  });

  /* ---------- static controls ---------- */
  $("mark").addEventListener("click", () => api.home());
  $("plus").addEventListener("click", newTabOptimistic);
  $("list").addEventListener("click", () => {
    const r = $("list").getBoundingClientRect();
    hideCard(true);
    api.listMenu(Math.round(r.left), Math.round(r.bottom + 2));
  });
  barEl.addEventListener("dblclick", (e) => {
    if (root.dataset.platform === "win32") return;
    if (e.target === barEl || e.target === $("space")) api.dblclickEmpty();
  });
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  // Only a real window resize (width) hides the card: the strip's own height changes whenever it grows for the card.
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    hideCard(true);
    updateFades();
  });

  /* ---------- hover card ---------- */
  let cardId = null;
  let cardShown = false;
  let overlayOpen = false;
  let overlayPx = 0;
  let hoverId = null;
  let dwellT = 0;
  let hideT = 0;
  let collapseT = 0;
  let warmUntil = 0;
  let token = 0;
  const previews = new Map(); // id -> {p, t, thumb}

  function getPreview(id) {
    const c = previews.get(id);
    const now = performance.now();
    if (c && now - c.t < 4000) return c.p;
    const entry = { t: now, thumb: undefined };
    entry.p = Promise.resolve(api.preview(id))
      .then((r) => (entry.thumb = r && r.thumb ? r.thumb : null))
      .catch(() => (entry.thumb = null));
    previews.set(id, entry);
    return entry.p;
  }

  function onTabEnter(rec) {
    hoverId = rec.id;
    clearTimeout(hideT);
    if (press) return;
    if (state && state.activeId !== rec.id) getPreview(rec.id);
    clearTimeout(dwellT);
    if (cardShown || performance.now() < warmUntil) showCard(rec.id);
    else dwellT = setTimeout(() => showCard(rec.id), DWELL);
  }
  function onTabLeave(rec) {
    if (hoverId === rec.id) hoverId = null;
    clearTimeout(dwellT);
    clearTimeout(hideT);
    hideT = setTimeout(() => hideCard(false), 60);
  }

  function fillCard(t, thumb) {
    cTitle.textContent = t.title;
    cMeta.textContent = metaLine(t);
    if (thumb) {
      if (cImg.getAttribute("src") !== thumb) cImg.src = thumb;
      cThumb.hidden = false;
    } else {
      cThumb.hidden = true;
      cImg.removeAttribute("src");
    }
  }
  function placeCard(rec, first) {
    const r = rec.el.getBoundingClientRect();
    const w = cardEl.offsetWidth || 288;
    const left = clamp(Math.round(r.left), 8, Math.max(8, window.innerWidth - w - 8));
    if (first) {
      cardEl.classList.add("nomove");
      cardEl.style.left = left + "px";
      void cardEl.offsetWidth;
      cardEl.classList.remove("nomove");
    } else cardEl.style.left = left + "px";
  }
  function resizeOverlay() {
    const h = Math.ceil(cardEl.getBoundingClientRect().height) + 12;
    if (h !== overlayPx) { overlayPx = h; api.setOverlay(h); }
    overlayOpen = true;
  }

  async function showCard(id) {
    const rec = recs.get(id);
    if (!rec || !state || press) return;
    const my = ++token;
    clearTimeout(collapseT);
    clearTimeout(hideT);
    let thumb = null;
    let late = null;
    if (state.activeId !== id) {
      const c = previews.get(id);
      if (c && c.thumb !== undefined) thumb = c.thumb;
      else {
        const p = getPreview(id);
        const r = await Promise.race([p, delay(120).then(() => undefined)]);
        if (my !== token) return;
        if (r === undefined) late = p; else thumb = r;
      }
    }
    if (my !== token || !recs.has(id)) return;
    const wasShown = cardShown;
    cardEl.classList.remove("instant");
    fillCard(rec.tab, thumb);
    placeCard(rec, !wasShown);
    cardId = id;
    resizeOverlay();
    if (!wasShown) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (my !== token) return;
    }
    cardEl.classList.add("show");
    cardShown = true;
    if (late) {
      late.then((th) => {
        if (my !== token || cardId !== id || !th) return;
        fillCard(rec.tab, th);
        resizeOverlay();
      });
    }
  }

  function hideCard(immediate) {
    clearTimeout(dwellT);
    clearTimeout(hideT);
    token++;
    if (!cardShown && !overlayOpen) return;
    if (cardShown) warmUntil = performance.now() + WARM;
    cardShown = false;
    cardId = null;
    if (immediate) cardEl.classList.add("instant");
    cardEl.classList.remove("show");
    clearTimeout(collapseT);
    const collapse = () => {
      if (cardShown) return;
      overlayOpen = false;
      overlayPx = 0;
      api.setOverlay(0);
    };
    if (immediate) collapse();
    else collapseT = setTimeout(collapse, 130);
  }

  /* ---------- go ---------- */
  api.onState(render);
  api.ready();
})();
