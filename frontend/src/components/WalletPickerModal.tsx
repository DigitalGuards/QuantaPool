import { observer } from "mobx-react-lite";
import { X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { useStore } from "@/stores/store";

/**
 * EIP-6963 wallet picker. Lists the QRL-capable wallets the store discovered
 * (the QRL browser extension and MyQRLWallet via the connect relay) and hands
 * a click back to the store to run the right connect path.
 */
export const WalletPickerModal = observer(() => {
  const { poolStore } = useStore();
  if (!poolStore.walletPickerOpen) return null;
  const wallets = poolStore.discoveredWallets;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur"
      onClick={() => poolStore.closeWalletPicker()}
    >
      <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Connect a wallet</CardTitle>
            <button
              onClick={() => poolStore.closeWalletPicker()}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            The QRL browser extension and MyQRLWallet (mobile and desktop) are detected
            automatically via EIP-6963.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {wallets.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-center text-sm text-muted-foreground">
              No QRL wallets detected. Install the QRL Web3 Wallet extension, or use MyQRLWallet
              on mobile or desktop.
            </p>
          ) : (
            wallets.map((w) => (
              <button
                key={w.uuid}
                onClick={() => void poolStore.connectWallet(w.uuid)}
                className="cursor-pointer flex w-full items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/10"
              >
                {w.icon ? (
                  <img src={w.icon} alt="" className="h-8 w-8 rounded-md" />
                ) : (
                  <span className="h-8 w-8 rounded-md bg-muted" />
                )}
                <span className="flex-1 font-medium">{w.name}</span>
                <span className="font-data text-xs text-blue-accent">{w.rdns}</span>
              </button>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
});
