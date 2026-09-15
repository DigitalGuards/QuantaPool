import { useEffect } from "react";
import { useLocation } from "react-router";

const CANONICAL_ORIGIN = "https://quantapool.com";

const ROUTE_META: Record<string, { title: string; description: string }> = {
  "/": {
    title: "QuantaPool | Native QRL Pooled Staking",
    description:
      "Native QRL pooled staking with internal positions, deterministic rewards and user-triggered QRL claims.",
  },
  "/withdrawals": {
    title: "Withdrawals and Rewards | QuantaPool",
    description:
      "Request native QRL withdrawals, claim reserved cash and manage pending deposits.",
  },
  "/stats": {
    title: "Protocol Stats | QuantaPool",
    description:
      "Native pool assets, cash reserves, pending deposits and earned operator fees.",
  },
  "/how-it-works": {
    title: "How It Works | QuantaPool",
    description:
      "Native validator funding, authenticated accounting, withdrawal queues, losses and recovery.",
  },
  "/legal": {
    title: "Project Status and Legal Notice | QuantaPool",
    description:
      "Development status, protocol risks, trust assumptions and project information.",
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
    window.scrollTo(0, 0);
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
