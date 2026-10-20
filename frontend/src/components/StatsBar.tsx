import { observer } from "mobx-react-lite";
import { useStore } from "@/stores/store";
import { formatAmount } from "@/utils/format";

export const StatsBar = observer(() => {
  const { poolStore } = useStore();
  const pool = poolStore.pool;
  const stats = [
    pool?.recovering
      ? (["Recovery cash paid", pool.recoveryPaid] as const)
      : (["Pool position value", pool?.riskAssets] as const),
    ["Available pool cash", pool?.freeCash],
    ["Reserved user claims", pool?.claimReserve],
    ["Pending deposits", pool?.pendingTotal],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border/60 sm:grid-cols-4">
      {stats.map(([label, value]) => (
        <div key={label} className="min-w-0 bg-background p-4">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="font-numeric mt-1 break-all text-sm font-semibold">
            {value === undefined ? "Unavailable" : `${formatAmount(value)} QRL`}
          </dd>
        </div>
      ))}
    </dl>
  );
});
