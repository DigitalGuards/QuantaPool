import { observer } from "mobx-react-lite";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import { formatAmount, shortenAddress } from "@/utils/format";
import { getExplorerAddressUrl } from "@/config/networks";

export const StatsPage = observer(() => {
  const { poolStore } = useStore();
  const pool = poolStore.pool,
    address = poolStore.network.contracts.nativePool;
  const rows = [
    [
      pool?.recovering ? "Frozen pool checkpoint value" : "Pool position value",
      pool?.riskAssets,
    ],
    ["Available pool cash", pool?.freeCash],
    ["Reserved user claims", pool?.claimReserve],
    ["Pending deposits", pool?.pendingTotal],
    ["Earned operator fee reserve", pool?.feeReserve],
    ...(pool?.recovering
      ? [["Recovery cash paid", pool.recoveryPaid] as const]
      : []),
    ["Minimum deposit", pool?.minDeposit],
  ] as const;
  return (
    <div className="page-enter mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="text-2xl font-bold">Protocol stats</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Native pool accounting</CardTitle>
          <CardDescription>
            {pool?.recovering
              ? "Frozen checkpoint value is a historical reference retained after recovery payments. Cash, reserves and recovery payments are current contract reads."
              : "Position value reflects the last applied authenticated checkpoint. Pool cash and reserves are current contract reads."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex flex-wrap justify-between gap-2 text-sm"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-numeric break-all">
                  {value === undefined
                    ? "Unavailable"
                    : `${formatAmount(value)} QRL`}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Settlement and fees</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Last applied execution block:{" "}
            <span className="font-numeric">
              {pool?.lastCheckpointBlock.toString() ?? "Unavailable"}
            </span>
          </p>
          <p>
            Accounting mode:{" "}
            {pool
              ? pool.recovering
                ? "Permanent recovery"
                : pool.poolStatus === 2n
                  ? "Cash recovery available"
                  : pool.poolStatus === 1n
                    ? "Verification needs catch-up"
                    : pool.stage !== 0n
                      ? "Processing checkpoint batches"
                      : "Normal accounting"
              : "Unavailable"}
          </p>
          <p>
            Accounting recovery deadline: slot{" "}
            <span className="font-numeric">
              {pool?.poolRecoveryDeadlineSlot.toString() ?? "Unavailable"}
            </span>
            . Only a completed and applied pool checkpoint can extend this
            deadline.
          </p>
          <p className="text-muted-foreground">
            The immutable operator fee is 10% of eligible net consensus gains
            realized when a user payout is reserved. Prior losses and fee-exempt
            contributions constrain the fee. The recipient can receive earned
            fees only.
          </p>
          <p className="text-muted-foreground">
            There is no promised APR. Principal and unreserved earnings may fall
            after validator losses. Execution tips have operator-controlled
            routing; the pool cannot guarantee receipt of every tip.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Deployment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            {poolStore.network.name} · Chain{" "}
            {poolStore.network.chainId?.toString() ?? "not configured"}
          </p>
          <p className="text-muted-foreground">Native pool address</p>
          {address ? (
            <a
              href={getExplorerAddressUrl(address)}
              target={poolStore.network.explorer ? "_blank" : undefined}
              rel="noreferrer"
              title={address}
              className="block break-all font-data text-xs text-identity-accent"
            >
              {shortenAddress(address)}
            </a>
          ) : (
            <p className="text-muted-foreground">No deployment configured</p>
          )}
          <p className="text-xs text-muted-foreground">
            Validator admission, public signed exits, portfolio proofs and
            finality verification are enforced through immutable contract
            bindings. See the source and deployment configuration for their
            exact addresses and trust parameters.
          </p>
        </CardContent>
      </Card>
    </div>
  );
});
