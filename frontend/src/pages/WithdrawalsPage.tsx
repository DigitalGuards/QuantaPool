import { useState } from "react";
import { observer } from "mobx-react-lite";
import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { Input } from "@/components/UI/Input";
import { AmountInput } from "@/components/AmountInput";
import { useStore } from "@/stores/store";
import { formatAmount } from "@/utils/format";
import {
  MAX_NATIVE_REQUEST,
  nativeRequestAmount,
} from "@/utils/nativePosition";

export const WithdrawalsPage = observer(() => {
  const { poolStore } = useStore();
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"principal" | "rewards">("principal");
  const [depositId, setDepositId] = useState("");
  const account = poolStore.account,
    pool = poolStore.pool;
  const request = poolStore.withdrawals[0];
  let parsed: bigint | null = null;
  try {
    if (amount) parsed = nativeRequestAmount(amount);
  } catch {
    /* Show validation below. */
  }
  const available = account
    ? kind === "rewards"
      ? account.rewards
      : account.qrlValue
    : 0n;
  const error =
    amount && parsed === null
      ? "Enter a positive QRL amount"
      : parsed !== null && parsed > available
        ? "Amount exceeds the last checkpoint value"
        : null;
  const canRequest = poolStore.normalOpen && !!account?.hasPosition && !request;
  const send = async (full: boolean) => {
    const ok =
      kind === "rewards"
        ? await poolStore.requestRewards(amount, full)
        : await poolStore.requestUnstake(amount, full);
    if (ok) setAmount("");
  };
  if (!account)
    return (
      <div className="page-enter mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-bold">Withdrawals and rewards</h1>
        <p className="mt-3 text-muted-foreground">
          Connect the wallet which owns your native position.
        </p>
        <Button
          className="mt-6"
          disabled={!poolStore.network.configured || poolStore.isConnecting}
          onClick={() => poolStore.connect()}
        >
          Connect wallet
        </Button>
      </div>
    );
  return (
    <div className="page-enter mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="text-2xl font-bold">Withdrawals and rewards</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="surface-ember">
          <CardHeader>
            <CardTitle className="text-xl">Request QRL</CardTitle>
            <CardDescription>
              {pool?.recovering
                ? "Normal requests are closed. Use the recovery claim below for available native cash."
                : "Principal and reward requests share one global FIFO queue. One active request per wallet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">Request type</legend>
              {(["principal", "rewards"] as const).map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <input
                    type="radio"
                    name="request-kind"
                    checked={kind === value}
                    onChange={() => {
                      setKind(value);
                      setAmount("");
                    }}
                  />
                  {value === "principal" ? "Withdraw position" : "Rewards only"}
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-muted-foreground">
              {pool?.recovering
                ? "Frozen checkpoint reference"
                : "Last checkpoint value"}
              : <span className="font-data">{formatAmount(available)} QRL</span>
            </p>
            <AmountInput
              value={amount}
              onChange={setAmount}
              balance={available}
              symbol="QRL"
              disabled={!canRequest}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              className="w-full"
              disabled={!canRequest || parsed === null || !!error}
              onClick={() => void send(false)}
            >
              Request amount
            </Button>
            <Button
              className="w-full"
              variant="outline"
              disabled={!canRequest || (kind === "rewards" && available === 0n)}
              onClick={() => void send(true)}
            >
              {kind === "rewards"
                ? "Request all available rewards"
                : "Request full position"}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Final value and the 10% eligible-gain fee are determined at a
              future authenticated cutoff. Full-position requests include the
              position's value at that cutoff. Validator exits may be required;
              there is no fixed withdrawal countdown.
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-2 border-l-identity-accent">
          <CardHeader>
            <CardTitle className="text-xl">Claim native QRL</CardTitle>
            <CardDescription>
              Reserved cash is paid directly to this wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="font-data text-2xl font-semibold">
              {formatAmount(account.claimable)} QRL
            </p>
            <Button
              className="w-full"
              disabled={!poolStore.canTransact || account.claimable === 0n}
              onClick={() => void poolStore.claim()}
            >
              Claim QRL
            </Button>
            {request ? (
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">
                  Queued {request.rewardsOnly ? "reward" : "position"} request #
                  {request.id.toString()}
                </p>
                <p className="font-data">
                  {request.amount === MAX_NATIVE_REQUEST
                    ? "Full amount at reservation"
                    : `${formatAmount(request.amount)} QRL requested`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Requested in block {request.requestBlock.toString()}. The
                  position remains exposed to rewards and losses until cash is
                  reserved.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!poolStore.normalOpen}
                  onClick={() => void poolStore.cancelRequest()}
                >
                  Cancel request
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No active withdrawal or reward request.
              </p>
            )}
            {pool?.poolStatus === 2n && !pool.recovering && (
              <div className="space-y-3 rounded-md border border-secondary/40 p-3">
                <p className="font-medium">Cash recovery is available</p>
                <p className="text-xs text-muted-foreground">
                  The verification or pool accounting deadline has passed.
                  Anyone can begin permanent recovery. This preserves reserved
                  claims and pending refunds, then distributes available and
                  later returned cash using frozen positions. Normal staking
                  cannot restart in this pool.
                </p>
                <Button
                  className="w-full"
                  disabled={!poolStore.canTransact}
                  onClick={() => void poolStore.beginRecovery()}
                >
                  Begin permanent recovery
                </Button>
              </div>
            )}
            {pool?.recovering && (
              <div className="space-y-3 rounded-md border border-secondary/40 p-3">
                <p className="font-medium">Permanent recovery</p>
                <p className="text-xs text-muted-foreground">
                  Your frozen position receives its share of available and later
                  returned cash. New fees are not earned during recovery.
                  Validator returns can still require independent exit
                  submission and protocol waiting periods.
                </p>
                <p className="font-data text-sm">
                  Currently recoverable:{" "}
                  {formatAmount(account.recoveryClaimable)} QRL
                </p>
                <p className="font-data text-sm">
                  Recovery paid to you: {formatAmount(account.recoveryClaimed)}{" "}
                  QRL
                </p>
                <Button
                  className="w-full"
                  disabled={
                    !poolStore.canTransact || account.recoveryClaimable === 0n
                  }
                  onClick={() => void poolStore.claimRecovery()}
                >
                  Claim recovered cash
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pending deposit refunds</CardTitle>
          <CardDescription>
            Unadmitted deposits remain refundable to their original wallet.
            Refunds wait while checkpoint batches are being processed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            Pending:{" "}
            <span className="font-data">
              {formatAmount(account.pending)} QRL
            </span>
          </p>
          {poolStore.pendingDeposits.map((item) => (
            <div
              key={item.id.toString()}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <span className="font-data">
                #{item.id.toString()} · {formatAmount(item.amount)} QRL
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!poolStore.canTransact || pool?.stage !== 0n}
                onClick={() => void poolStore.cancelPending(item.id)}
              >
                Refund deposit
              </Button>
            </div>
          ))}
          {account.pending > 0n && (
            <div className="space-y-2">
              <label
                htmlFor="pending-id"
                className="text-xs text-muted-foreground"
              >
                Deposit ID from your DepositQueued transaction (use this if
                history is unavailable)
              </label>
              <div className="flex gap-2">
                <Input
                  id="pending-id"
                  className="min-w-0"
                  inputMode="numeric"
                  value={depositId}
                  onChange={(event) =>
                    setDepositId(event.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder="Deposit ID"
                />
                <Button
                  variant="outline"
                  disabled={
                    !poolStore.canTransact ||
                    pool?.stage !== 0n ||
                    !/^\d+$/.test(depositId)
                  }
                  onClick={() =>
                    void poolStore.cancelPending(BigInt(depositId))
                  }
                >
                  Refund
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
