import { observer } from "mobx-react-lite";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  ExternalLink,
  Undo2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import type { ActivityType } from "@/stores/poolStore";
import {
  getExplorerAddressUrl,
  getExplorerTxUrl,
  NATIVE_UNIT,
} from "@/config/networks";
import { formatAmount } from "@/utils/format";

const ACTIVITY_META: Record<
  ActivityType,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
  }
> = {
  deposit: {
    label: "Deposit queued",
    icon: ArrowDownToLine,
    color: "text-success",
  },
  request: {
    label: "Withdrawal requested",
    icon: Clock,
    color: "text-secondary",
  },
  claim: {
    label: "QRL claimed",
    icon: ArrowUpFromLine,
    color: "text-identity-accent",
  },
  admitted: {
    label: "Deposit admitted",
    icon: ArrowDownToLine,
    color: "text-success",
  },
  recovery: {
    label: "Recovery cash claimed",
    icon: ArrowUpFromLine,
    color: "text-identity-accent",
  },
  cancel: {
    label: "Request cancelled",
    icon: Undo2,
    color: "text-muted-foreground",
  },
  completed: {
    label: "Request completed with no payout",
    icon: Clock,
    color: "text-muted-foreground",
  },
};

const MAX_ROWS = 8;

/** The connected account's staking history, sourced from native pool events. */
export const ActivityCard = observer(() => {
  const { poolStore } = useStore();
  const account = poolStore.account;
  if (!account) return null;

  const rows = poolStore.activity.slice(0, MAX_ROWS);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Your staking activity</CardTitle>
          {poolStore.network.explorer && (
            <a
              href={getExplorerAddressUrl(account.address)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-identity-accent hover:underline"
            >
              View on explorer <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">
            {poolStore.activityError
              ? "Activity history is unavailable from this RPC. Position and claim data are read separately."
              : "No staking activity yet for this address."}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((item) => {
              const meta = ACTIVITY_META[item.type];
              const Icon = meta.icon;
              return (
                <li
                  key={`${item.txHash}-${item.type}-${item.blockNumber}`}
                  className="flex items-center gap-3 py-2.5 text-sm"
                >
                  <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{meta.label}</p>
                    {item.type === "completed" && (
                      <p className="text-xs text-muted-foreground">
                        Your position retains its rights to later returns and
                        recovery cash.
                      </p>
                    )}
                    <p className="font-data text-xs text-muted-foreground">
                      Block {item.blockNumber.toString()}
                    </p>
                  </div>
                  <div className="text-right">
                    {item.qrlAmount !== null && (
                      <p className="font-data font-medium">
                        {formatAmount(item.qrlAmount)} {NATIVE_UNIT}
                      </p>
                    )}
                  </div>
                  {item.txHash && poolStore.network.explorer && (
                    <a
                      href={getExplorerTxUrl(item.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-muted-foreground hover:text-identity-accent"
                      aria-label="View transaction on explorer"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {poolStore.activity.length > MAX_ROWS && (
          <p className="pt-2 text-center text-xs text-muted-foreground">
            Showing the latest {MAX_ROWS} of {poolStore.activity.length}.
            Earlier activity remains in the chain transaction history.
          </p>
        )}
      </CardContent>
    </Card>
  );
});
