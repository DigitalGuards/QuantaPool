import { observer } from "mobx-react-lite";
import { CheckCircle2, ExternalLink, Loader2, X, XCircle } from "lucide-react";
import { useStore } from "@/stores/store";
import { getExplorerTxUrl } from "@/config/networks";
import { cn } from "@/utils/cn";

/** Floating transaction status banner (pending / confirmed / failed). */
export const TxBanner = observer(() => {
  const { poolStore } = useStore();
  const { tx } = poolStore;

  if (tx.state === "idle") return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-lg border bg-background/95 p-4 shadow-lg backdrop-blur",
        tx.state === "pending" && "border-l-4 border-l-blue-accent",
        tx.state === "confirmed" && "border-l-4 border-l-green-500",
        tx.state === "failed" && "border-l-4 border-l-destructive",
      )}
      role="status"
    >
      {tx.state === "pending" && (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-accent" />
      )}
      {tx.state === "confirmed" && (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
      )}
      {tx.state === "failed" && <XCircle className="h-5 w-5 shrink-0 text-destructive" />}

      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          {tx.label}
          {tx.state === "pending" && " — waiting for confirmation…"}
          {tx.state === "confirmed" && " confirmed"}
          {tx.state === "failed" && " failed"}
        </p>
        {tx.state === "pending" && !tx.txHash && (
          <p className="text-muted-foreground">Confirm the transaction in your wallet.</p>
        )}
        {tx.error && <p className="truncate text-muted-foreground">{tx.error}</p>}
        {tx.txHash && (
          <a
            href={getExplorerTxUrl(tx.txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-accent hover:underline"
          >
            View on explorer <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {tx.state !== "pending" && (
        <button
          onClick={() => poolStore.clearTx()}
          className="cursor-pointer shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
});
