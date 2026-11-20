// A bot's disk size, in its Details: how full the disk is, and the sizes the
// person can give it (the same choice the Computer's file manager offers).

import { useEffect, useState } from "react";
import { MenuButton, toast, type MenuEntry } from "@opendeck/shell";
import { DISK_QUOTAS_GB, type DiskListing } from "../shared/contract.ts";
import { errorText, invoke, on } from "../shared/api.ts";
import { formatGb, formatSize } from "./diskPaths.ts";

const GB = 1024 * 1024 * 1024;

export function DiskSize({ slug }: { slug: string }) {
  const [listing, setListing] = useState<DiskListing | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      invoke("crew:disk", slug, "")
        .then((l) => live && setListing(l))
        .catch((e) => toast(errorText(e)));
    load();
    const off = on("crew:disk", (p) => {
      if (p.slug === slug) load();
    });
    return () => {
      live = false;
      off();
    };
  }, [slug]);

  const setQuota = (gb: number) => {
    invoke("crew:setQuota", slug, gb)
      .then((l) => {
        setListing(l);
        toast(`Disk is ${gb} GB.`);
      })
      .catch((e) => toast(errorText(e)));
  };

  const entries: MenuEntry[] = DISK_QUOTAS_GB.map((gb) => ({
    label: formatGb(gb),
    checked: listing ? Math.round(listing.quota / GB) === gb : false,
    onSelect: () => setQuota(gb),
  }));
  const usedPct = listing && listing.quota > 0 ? Math.min(100, (listing.used / listing.quota) * 100) : 0;
  const text = listing ? `${formatSize(listing.used)} of ${formatSize(listing.quota)}` : "Checking the disk";

  return (
    <div className="dfield">
      <div className="fm-meter" role="meter" aria-label="Disk space used" aria-valuemin={0} aria-valuemax={listing?.quota ?? 0} aria-valuenow={listing?.used ?? 0} aria-valuetext={listing ? text : undefined}>
        <span style={{ width: `${usedPct}%` }} />
      </div>
      <div className="inline">
        <p className="fm-usage-text">{text}</p>
        <MenuButton className="btn ghost" label="Disk size" entries={entries}>
          Change
        </MenuButton>
      </div>
    </div>
  );
}
