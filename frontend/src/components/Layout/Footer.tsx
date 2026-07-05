import { useStore } from "@/stores/store";

export function Footer() {
  const { poolStore } = useStore();

  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row">
        <span>QuantaPool: post-quantum liquid staking for QRL</span>
        <div className="flex items-center gap-6">
          <a
            href="https://qrlwallet.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            MyQRLWallet
          </a>
          <a
            href="https://myqrlwallet.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Ecosystem
          </a>
          <a
            href={poolStore.network.explorer}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Explorer
          </a>
          <a
            href="https://github.com/DigitalGuards/QuantaPool"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
