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
          title={`${poolStore.account.address}: view on Zondscan`}
          className="inline-flex min-h-9 items-center whitespace-nowrap rounded-md border border-identity-accent/15 bg-identity-accent/[0.04] px-2.5 font-data text-xs text-identity-accent transition-colors hover:border-identity-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {shortenAddress(poolStore.account.address)}
        </a>
        <Button
          variant="outline"
          size="sm"
          disabled={poolStore.isDisconnecting}
          onClick={() => void poolStore.disconnect()}
          aria-label="Disconnect wallet"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">
            {poolStore.isDisconnecting ? "Disconnecting…" : "Disconnect"}
          </span>
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" disabled={poolStore.isConnecting} onClick={() => void poolStore.connect()}>
      <Wallet className="h-4 w-4" />
      {poolStore.isConnecting ? "Connecting…" : "Connect wallet"}
    </Button>
  );
});
