import { observer } from "mobx-react-lite";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { Skeleton } from "@/components/UI/Skeleton";
import { useStore } from "@/stores/store";
import { getExplorerAddressUrl, VALIDATOR_STAKE_QRL } from "@/config/networks";
import { formatAmount, formatRate, shortenAddress } from "@/utils/format";

function Row({ label, value }: { label: string; value: React.ReactNode | null }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? <Skeleton className="h-4 w-20" />}</span>
    </div>
  );
}

export const StatsPage = observer(() => {
  const { poolStore } = useStore();
  const pool = poolStore.pool;
  const { contracts } = poolStore.network;

  const bufferProgress = pool
    ? Math.min(100, Number((pool.buffered * 100n) / VALIDATOR_STAKE_QRL))
    : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="text-2xl font-bold">Protocol stats</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-l-2 border-l-secondary sm:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pool</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Row
              label="Total pooled QRL"
              value={pool ? `${formatAmount(pool.totalPooled)} QRL` : null}
            />
            <Row
              label="Total stQRL shares"
              value={pool ? formatAmount(pool.totalShares) : null}
            />
            <Row
              label="Exchange rate"
              value={pool ? `1 stQRL = ${formatRate(pool.exchangeRate)} QRL` : null}
            />
            <Row
              label="Withdrawal reserve"
              value={pool ? `${formatAmount(pool.reserveBalance)} QRL` : null}
            />
            <Row
              label="Shares pending withdrawal"
              value={pool ? formatAmount(pool.pendingWithdrawalShares) : null}
            />
            <Row
              label="Deposits"
              value={
                pool ? (
                  pool.paused ? (
                    <span className="text-secondary">Paused</span>
                  ) : (
                    <span className="text-green-400">Open</span>
                  )
                ) : null
              }
            />
          </CardContent>
        </Card>

        <Card className="border-l-2 border-l-[#4aafff]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Validators</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Row label="Active" value={pool ? pool.activeValidators.toString() : null} />
            <Row label="Pending" value={pool ? pool.pendingValidators.toString() : null} />
            <Row label="Funded by pool" value={pool ? pool.validators.toString() : null} />
            <div className="pt-2">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>Next validator (40,000 QRL)</span>
                <span>{pool ? `${formatAmount(pool.buffered, 18, 0)} QRL buffered` : ""}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-secondary transition-all"
                  style={{ width: `${bufferProgress}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-2 border-l-[#4aafff]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rewards</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Row
              label="Total rewards"
              value={pool ? `${formatAmount(pool.totalRewards)} QRL` : null}
            />
            <Row
              label="Slashing losses"
              value={pool ? `${formatAmount(pool.totalSlashing)} QRL` : null}
            />
            <Row
              label="Net rewards"
              value={pool ? `${formatAmount(pool.netRewards)} QRL` : null}
            />
            <Row label="Protocol fee" value="None" />
          </CardContent>
        </Card>

        <Card className="sm:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Contracts ({poolStore.network.name})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(
              [
                ["DepositPool", contracts.depositPool],
                ["stQRL token", contracts.stQRL],
                ["ValidatorManager", contracts.validatorManager],
              ] as const
            ).map(([label, address]) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                {address ? (
                  <a
                    href={getExplorerAddressUrl(address)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-[#4aafff] hover:underline"
                  >
                    {shortenAddress(address, 6)}
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">Not deployed</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
});
