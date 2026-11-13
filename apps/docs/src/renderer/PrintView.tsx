// The whole doc, every tab under its title, for the PDF export's hidden
// window. Same renderer as the page; tells the main process when every
// image and font is in.

import { useEffect, useState } from "react";
import { type LoadedDoc, flattenTabs, loadDoc, tabLabel, tabMarkup } from "@opendeck/doc";
import { api, assetBase, setAssetBase } from "./api.ts";

export function PrintView() {
  const [doc, setDoc] = useState<LoadedDoc | null>(null);

  useEffect(() => {
    void (async () => {
      const ref = await api().current();
      if (ref) setAssetBase(ref.asset);
      setDoc(await loadDoc({ read: (p) => api().read(p), list: (d) => api().list(d) }));
    })();
  }, []);

  useEffect(() => {
    if (!doc) return;
    void (async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))));
      api().exports.printReady();
    })();
  }, [doc]);

  if (!doc) return null;
  const f = doc.index.fonts;
  return (
    <main className={`print dp-paper head-${f.headings} text-${f.text}`}>
      <h1 className="print-title">{doc.index.title}</h1>
      {flattenTabs(doc.index.tabs).map((t) => {
        const tab = doc.tabs.get(t.ref.id)?.tab;
        if (!tab) return null;
        return (
          <section key={t.ref.id} className="print-tab">
            <h1 className="dp-title">{tabLabel(doc.index.tabs, t.ref.id)}</h1>
            <article className="dp-body" dangerouslySetInnerHTML={{ __html: tabMarkup(tab, { assetBase: assetBase(), dropdowns: doc.index.dropdowns }) }} />
          </section>
        );
      })}
    </main>
  );
}
