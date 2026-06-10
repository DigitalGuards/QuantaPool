import { observer } from "mobx-react-lite";
import { LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { useStore } from "@/stores/store";
import { getExplorerAddressUrl } from "@/config/networks";
import { shortenAddress } from "@/utils/format";

export const ConnectButton = observer(() => {
  const { poolStore } = useStore();

  if (poolStore.account) {
    return (
      <div className="flex items-center gap-2">
        <a
          href={getExplorerAddressUrl(poolStore.account.address)}
          target="_blank"
          rel="noreferrer"
          title="View address on Zondscan"
          className="hidden sm:inline rounded-md border border-border bg-muted/40 px-3 py-1.5 font-mono text-xs text-secondary hover:border-secondary/60"
        >
          {shortenAddress(poolStore.account.address)}
        </a>
        <Button
          variant="outline"
          size="sm"
          onClick={() => poolStore.disconnect()}
          aria-label="Disconnect wallet"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Disconnect</span>
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      disabled={poolStore.isConnecting}
      onClick={() => void poolStore.connect()}
    >
      <Wallet className="h-4 w-4" />
      {poolStore.isConnecting ? "Connecting…" : "Connect wallet"}
    </Button>
  );
});
