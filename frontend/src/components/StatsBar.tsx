import { observer } from "mobx-react-lite";
import { Skeleton } from "@/components/UI/Skeleton";
import { useStore } from "@/stores/store";
import { formatAmount, formatRate } from "@/utils/format";

/** Compact protocol stats row shown under the stake widget (Lido-style). */
export const StatsBar = observer(() => {
  const { poolStore } = useStore();
  const pool = poolStore.pool;

  const stats = [
    {
      label: "Total staked",
      value: pool ? `${formatAmount(pool.totalPooled, 18, 0)} QRL` : null,
    },
    {
      label: "stQRL exchange rate",
      value: pool ? `1 stQRL = ${formatRate(pool.exchangeRate)} QRL` : null,
    },
    {
      label: "Active validators",
      value: pool ? pool.activeValidators.toString() : null,
    },
    {
      label: "Net rewards",
      value: pool ? `${formatAmount(pool.netRewards)} QRL` : null,
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border/60 sm:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-background p-4">
          <dt className="text-xs text-muted-foreground">{stat.label}</dt>
          <dd className="mt-1 text-sm font-semibold">
            {stat.value ?? <Skeleton className="h-5 w-24" />}
          </dd>
        </div>
      ))}
    </dl>
  );
});
