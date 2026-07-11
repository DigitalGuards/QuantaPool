import { NavLink, Link } from "react-router-dom";
import { observer } from "mobx-react-lite";
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

export const Header = observer(function Header() {
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
                      ? "bg-primary/10 text-primary"
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
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-accent/30 bg-blue-accent/10 px-2.5 py-0.5 text-xs font-medium text-blue-accent">
            <span
              aria-hidden
              className={cn(
                "glow-dot h-1.5 w-1.5 rounded-full",
                poolStore.rpcError
                  ? "bg-destructive text-destructive"
                  : "bg-success text-success",
              )}
            />
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
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
});
