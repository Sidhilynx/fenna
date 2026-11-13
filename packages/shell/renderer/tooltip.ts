// Tooltips for every [title] in the app, drawn in the shell's look instead of
// the system's: after a short rest on hover, at once when moving between
// controls, and on keyboard focus. A title moves to data-tip the first time
// it is shown; a control named only by its title keeps that name as its
// aria-label, so nothing is lost to screen readers.

const DELAY = 450;
const WARM = 500;

let installed = false;

export function installTooltips(): void {
  if (installed) return;
  installed = true;
  let tip: HTMLDivElement | null = null;
  let target: HTMLElement | null = null;
  let timer = 0;
  let hiddenAt = 0;

  const hide = () => {
    window.clearTimeout(timer);
    if (tip) hiddenAt = performance.now();
    tip?.remove();
    tip = null;
    target = null;
  };

  const textOf = (el: HTMLElement): string => {
    const t = el.getAttribute("title");
    if (t) {
      el.dataset.tip = t;
      el.removeAttribute("title");
      if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", t);
    }
    return el.dataset.tip ?? "";
  };

  const show = (el: HTMLElement, text: string) => {
    if (!el.isConnected || target !== el) return;
    tip = document.createElement("div");
    tip.className = "shell-tip";
    tip.setAttribute("role", "tooltip");
    tip.textContent = text;
    document.body.append(tip);
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    tip.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  };

  const arm = (el: HTMLElement | null) => {
    if (el === target) return;
    hide();
    if (!el) return;
    const text = textOf(el);
    if (!text) return;
    target = el;
    timer = window.setTimeout(() => show(el, text), performance.now() - hiddenAt < WARM ? 0 : DELAY);
  };

  const owner = (n: EventTarget | null) => (n instanceof Element ? n.closest<HTMLElement>("[title], [data-tip]") : null);

  document.addEventListener("pointerover", (e) => arm(owner(e.target)), true);
  document.addEventListener("pointerleave", hide);
  document.addEventListener("focusin", (e) => {
    const el = owner(e.target);
    if (el && el.matches(":focus-visible")) arm(el);
  });
  document.addEventListener("focusout", hide);
  for (const ev of ["pointerdown", "keydown", "wheel"] as const) document.addEventListener(ev, hide, true);
  window.addEventListener("blur", hide);
  window.addEventListener("scroll", hide, true);
}
