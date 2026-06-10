import { observer } from "mobx-react-lite";
import { ArrowDownToLine, ArrowUpFromLine, Clock, ExternalLink, Undo2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import type { ActivityType } from "@/stores/poolStore";
import { getExplorerAddressUrl, getExplorerTxUrl } from "@/config/networks";
import { formatAmount } from "@/utils/format";

const ACTIVITY_META: Record<
  ActivityType,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  deposit: { label: "Staked", icon: ArrowDownToLine, color: "text-green-400" },
  request: { label: "Withdrawal requested", icon: Clock, color: "text-secondary" },
  claim: { label: "Withdrawal claimed", icon: ArrowUpFromLine, color: "text-blue-accent" },
  cancel: { label: "Request cancelled", icon: Undo2, color: "text-muted-foreground" },
};

const MAX_ROWS = 8;

/** The connected account's staking history, sourced from DepositPool events. */
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
          <a
            href={getExplorerAddressUrl(account.address)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-accent hover:underline"
          >
            View on Zondscan <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">
            {poolStore.activityError
              ? "Activity is unavailable right now. Use the Zondscan link above."
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
                    <p className="text-xs text-muted-foreground">
                      Block {item.blockNumber.toString()}
                    </p>
                  </div>
                  <div className="text-right">
                    {item.qrlAmount !== null && (
                      <p className="font-medium">{formatAmount(item.qrlAmount)} QRL</p>
                    )}
                    {item.shares !== null && (
                      <p className="text-xs text-muted-foreground">
                        {formatAmount(item.shares)} stQRL
                      </p>
                    )}
                  </div>
                  {item.txHash && (
                    <a
                      href={getExplorerTxUrl(item.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-muted-foreground hover:text-blue-accent"
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
            Showing the latest {MAX_ROWS} of {poolStore.activity.length}. Full history on
            Zondscan.
          </p>
        )}
      </CardContent>
    </Card>
  );
});
