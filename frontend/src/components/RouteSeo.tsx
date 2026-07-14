import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const CANONICAL_ORIGIN = "https://quantapool.com";

const ROUTE_META: Record<string, { title: string; description: string }> = {
  "/": {
    title: "QuantaPool | Liquid Staking on QRL 2.0",
    description:
      "Stake QRL, receive stQRL, and earn validator rewards automatically. QuantaPool is liquid staking on QRL 2.0, the post-quantum blockchain, built by DigitalGuards.",
  },
  "/withdrawals": {
    title: "Withdrawals | QuantaPool",
    description:
      "Request and claim QRL withdrawals from your stQRL position on QuantaPool, liquid staking on QRL 2.0, the post-quantum blockchain.",
  },
  "/stats": {
    title: "Protocol Stats | QuantaPool",
    description:
      "Live QuantaPool protocol statistics: total QRL staked, stQRL exchange rate, and validator status on QRL 2.0, the post-quantum blockchain.",
  },
  "/how-it-works": {
    title: "How It Works | QuantaPool",
    description:
      "How QuantaPool liquid staking works: deposit QRL, mint stQRL shares, earn validator rewards, and withdraw on QRL 2.0, the post-quantum blockchain.",
  },
  "/legal": {
    title: "Legal Notice | QuantaPool",
    description:
      "Legal notice for QuantaPool: testnet-only scope, no crypto-asset services, open-source license, and provider information.",
  },
};

/**
 * Keeps document.title, meta description, canonical, and og:url in sync with
 * the active route. The canonical always points at quantapool.com, so the
 * quantapool.io mirror (same build, same host) self-identifies as a duplicate.
 */
export function RouteSeo() {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = ROUTE_META[pathname] ?? ROUTE_META["/"];
    const canonicalPath = pathname in ROUTE_META ? pathname : "/";
    const canonicalUrl =
      canonicalPath === "/"
        ? `${CANONICAL_ORIGIN}/`
        : `${CANONICAL_ORIGIN}${canonicalPath}`;

    document.title = meta.title;

    const setMeta = (selector: string, attr: string, value: string) => {
      const el = document.head.querySelector(selector);
      if (el) el.setAttribute(attr, value);
    };

    setMeta('meta[name="description"]', "content", meta.description);
    setMeta('link[rel="canonical"]', "href", canonicalUrl);
    setMeta('meta[property="og:url"]', "content", canonicalUrl);
    setMeta('meta[property="og:title"]', "content", meta.title);
    setMeta('meta[property="og:description"]', "content", meta.description);
    setMeta('meta[name="twitter:title"]', "content", meta.title);
    setMeta('meta[name="twitter:description"]', "content", meta.description);
  }, [pathname]);

  return null;
}
