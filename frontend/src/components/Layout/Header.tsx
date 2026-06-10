import { NavLink, Link } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { ConnectButton } from "@/components/ConnectButton";
import { useStore } from "@/stores/store";
import { cn } from "@/utils/cn";

const navItems = [
  { to: "/", label: "Stake" },
  { to: "/withdrawals", label: "Withdrawals" },
  { to: "/stats", label: "Stats" },
  { to: "/how-it-works", label: "How it works" },
];

export function Header() {
  const { poolStore } = useStore();

  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link to="/" aria-label="QuantaPool home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-secondary/10 text-secondary"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-secondary/40 bg-secondary/10 px-2.5 py-0.5 text-xs font-medium text-secondary">
            {poolStore.network.shortName}
          </span>
          <ConnectButton />
        </div>
      </div>
      {/* Mobile nav */}
      <nav className="flex items-center justify-around border-t border-border/60 py-2 md:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "px-3 py-1 text-sm font-medium",
                isActive ? "text-secondary" : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
