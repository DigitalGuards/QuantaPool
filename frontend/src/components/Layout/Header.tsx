import { NavLink, Link } from "react-router";
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
      <div className="mx-auto flex min-h-18 max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:flex-nowrap sm:py-0">
        <div className="flex items-center gap-8 sm:self-stretch">
          <Link to="/" aria-label="QuantaPool home">
            <Logo />
          </Link>
          <nav aria-label="Main navigation" className="hidden items-stretch gap-6 lg:flex">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end className="header-nav-link">
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex w-full items-center justify-end gap-3 sm:w-auto">
          <span
            className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground"
            title={poolStore.rpcError ? "Network unavailable" : poolStore.network.name}
          >
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                poolStore.rpcError ? "bg-destructive text-destructive" : "bg-success text-success",
              )}
            />
            {poolStore.network.shortName}
          </span>
          <ConnectButton />
        </div>
      </div>
      {/* Mobile nav */}
      <nav
        aria-label="Mobile navigation"
        className="flex items-center justify-around border-t border-border/60 lg:hidden"
      >
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end className="header-nav-link">
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
});
