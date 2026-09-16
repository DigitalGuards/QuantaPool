import { useState } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router";
import { ArrowDownToLine, ShieldCheck } from "lucide-react";
import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { AmountInput } from "@/components/AmountInput";
import { ActivityCard } from "@/components/ActivityCard";
import { StatsBar } from "@/components/StatsBar";
import { useStore } from "@/stores/store";
import { formatAmount, parseUnits } from "@/utils/format";

export const StakePage = observer(() => {
  const { poolStore } = useStore();
  const [amount, setAmount] = useState("");
  const account = poolStore.account,
    pool = poolStore.pool;
  let parsed: bigint | null = null;
  try {
    if (amount) parsed = parseUnits(amount);
  } catch {
    /* Validation below. */
  }
  const error =
    amount && (parsed === null || parsed === 0n)
      ? "Enter a positive QRL amount"
      : parsed !== null && pool && parsed < pool.minDeposit
        ? `Minimum deposit: ${formatAmount(pool.minDeposit)} QRL`
        : parsed !== null &&
            poolStore.stakeableBalance !== null &&
            parsed > poolStore.stakeableBalance
          ? "Leave enough QRL in your wallet for transaction fees"
          : null;
  const ready =
    !!account &&
    poolStore.normalOpen &&
    parsed !== null &&
    parsed > 0n &&
    !error;
  const rows = account
    ? pool?.recovering
      ? ([
          ["Currently recoverable", account.recoveryClaimable],
          ["Recovery paid to you", account.recoveryClaimed],
          ["Reserved claimable QRL", account.claimable],
          ["Pending deposit", account.pending],
          ["Frozen checkpoint value", account.qrlValue],
          ["Frozen principal basis", account.principalBasis],
        ] as const)
      : ([
          ["Staked value", account.qrlValue],
          ["Remaining principal basis", account.principalBasis],
          ["Unreserved earnings", account.rewards],
          ["Claimable QRL", account.claimable],
          ["Pending deposit", account.pending],
          ["Principal below basis", account.loss],
        ] as const)
    : [];
  return (
    <div className="page-enter space-y-8 py-8">
      <section className="mx-auto max-w-2xl text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Native QRL pooled staking
        </p>
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
          Your QRL. A shared validator pool.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Deposit native QRL directly into the pool. Your position, rewards and
          withdrawals are accounted for on chain, with native QRL returned to
          your wallet.
        </p>
        <p className="mt-3 inline-flex items-center gap-2 text-xs text-identity-accent">
          <ShieldCheck className="h-4 w-4" /> Non-transferable positions · No
          guaranteed return
        </p>
      </section>
      <section className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
        <Card className="surface-ember">
          <CardHeader>
            <CardTitle className="text-xl">Deposit QRL</CardTitle>
            <CardDescription>
              New deposits wait for a future authenticated checkpoint before
              joining the pool.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Wallet balance:{" "}
              <span className="font-data">
                {account
                  ? `${formatAmount(account.qrlBalance)} QRL`
                  : "Connect your wallet"}
              </span>
            </p>
            <AmountInput
              value={amount}
              onChange={setAmount}
              balance={poolStore.stakeableBalance}
              symbol="QRL"
              disabled={!poolStore.normalOpen}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <p className="text-xs leading-relaxed text-muted-foreground">
              A fixed 10% fee applies only to eligible net consensus gains when
              cash is reserved for your payout. Principal and fee-exempt gifts
              are excluded.
            </p>
            {pool?.poolStatus === 2n && !pool.recovering && (
              <p className="rounded-md border border-secondary/40 p-3 text-sm">
                The accounting deadline has expired. Cash recovery is available
                on the withdrawals page. Pending deposit refunds and reserved
                claims remain available.
              </p>
            )}
            {pool?.poolStatus === 1n && (
              <p className="rounded-md border border-secondary/40 p-3 text-sm">
                Verification needs to catch up before new staking requests can
                proceed.
              </p>
            )}
            {pool?.recovering && (
              <p className="text-sm text-secondary">
                The pool is in permanent recovery. Existing claims and
                pending-deposit refunds remain available.
              </p>
            )}
            {pool?.stage !== undefined &&
              pool.stage !== 0n &&
              !pool.recovering && (
                <p className="text-sm text-secondary">
                  The pool is processing a checkpoint. New actions resume after
                  its bounded batches finish.
                </p>
              )}
            {account ? (
              <Button
                className="w-full"
                size="lg"
                disabled={!ready}
                onClick={async () => {
                  if (ready && (await poolStore.stake(amount))) setAmount("");
                }}
              >
                <ArrowDownToLine className="h-4 w-4" />
                Deposit QRL
              </Button>
            ) : (
              <Button
                className="w-full"
                size="lg"
                disabled={
                  !poolStore.network.configured || poolStore.isConnecting
                }
                onClick={() => poolStore.connect()}
              >
                Connect wallet to deposit
              </Button>
            )}
          </CardContent>
        </Card>
        <Card className="border-l-2 border-l-identity-accent">
          <CardHeader>
            <CardTitle className="text-xl">
              {pool?.recovering ? "Your recovery" : "Your position"}
            </CardTitle>
            <CardDescription>
              {pool?.recovering
                ? "Recoverable cash updates as native QRL reaches the pool."
                : "Values follow the last applied checkpoint."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {account ? (
              <dl className="space-y-3">
                {rows.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-data break-all font-medium">
                      {formatAmount(value)} QRL
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Connect your wallet to see your principal, earnings and
                claimable QRL.
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {pool?.recovering
                ? "Frozen checkpoint value and principal basis are historical references that remain unchanged after recovery payments. Your frozen position determines your portion of later returned cash."
                : "Unreserved earnings and principal remain exposed to validator losses. A withdrawal request stays exposed until native cash is reserved. Principal basis is an accounting reference, not a guaranteed payout."}
            </p>
            <Link
              to="/withdrawals"
              className="inline-flex text-sm font-medium text-identity-accent hover:underline"
            >
              Manage withdrawals and rewards →
            </Link>
          </CardContent>
        </Card>
      </section>
      <section className="mx-auto max-w-3xl">
        <StatsBar />
      </section>
      <section className="mx-auto max-w-3xl">
        <ActivityCard />
      </section>
      <section className="mx-auto max-w-3xl rounded-lg border p-5 text-sm leading-relaxed text-muted-foreground">
        Validator funding uses QRL's native 40,000 QRL size. Withdrawals use
        available pool cash in queue order, with validator exits where needed.
        Timing depends on protocol eligibility, finality and liquidity.{" "}
        <Link
          to="/how-it-works"
          className="text-identity-accent hover:underline"
        >
          Read the process and trust assumptions.
        </Link>
      </section>
    </div>
  );
});
