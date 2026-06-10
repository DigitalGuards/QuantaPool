import { useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { Clock, Download, Undo2 } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/UI/Card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/Tabs";
import { AmountInput } from "@/components/AmountInput";
import { useStore } from "@/stores/store";
import { BLOCK_TIME_SECONDS, WITHDRAWAL_DELAY_BLOCKS } from "@/config/networks";
import { blocksToTime, formatAmount, parseUnits } from "@/utils/format";

export const WithdrawalsPage = observer(() => {
  const { poolStore } = useStore();
  const [shares, setShares] = useState("");

  const account = poolStore.account;
  const unlockedShares = account ? account.shares - account.lockedShares : null;

  const parsedShares = useMemo(() => {
    if (!shares) return null;
    try {
      return parseUnits(shares);
    } catch {
      return null;
    }
  }, [shares]);

  const validationError = useMemo(() => {
    if (!account || !shares) return null;
    if (parsedShares === null) return "Enter a valid amount";
    if (parsedShares === 0n) return null;
    if (unlockedShares !== null && parsedShares > unlockedShares) {
      return "Amount exceeds your unlocked stQRL";
    }
    return null;
  }, [account, shares, parsedShares, unlockedShares]);

  const previewQrl =
    parsedShares !== null && parsedShares > 0n ? poolStore.qrlForShares(parsedShares) : null;

  const canRequest =
    !!account &&
    parsedShares !== null &&
    parsedShares > 0n &&
    !validationError &&
    poolStore.tx.state !== "pending" &&
    !(poolStore.pool?.paused ?? false);

  const onRequest = async () => {
    if (!canRequest) return;
    const ok = await poolStore.requestUnstake(shares);
    if (ok) setShares("");
  };

  const pending = poolStore.pendingWithdrawals;
  const claimableCount = poolStore.claimableWithdrawals.length;

  if (!account) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-bold">Withdrawals</h1>
        <p className="mt-3 text-muted-foreground">
          Connect your wallet to request and claim withdrawals.
        </p>
        <Button
          className="mt-6"
          disabled={poolStore.isConnecting}
          onClick={() => void poolStore.connect()}
        >
          {poolStore.isConnecting ? "Connecting…" : "Connect wallet"}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4 py-6">
      <h1 className="text-2xl font-bold">Withdrawals</h1>

      <Tabs defaultValue="request">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="request">Request</TabsTrigger>
          <TabsTrigger value="claim">
            Claim{claimableCount > 0 ? ` (${claimableCount})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* Request withdrawal */}
        <TabsContent value="request">
          <Card className="border-l-2 border-l-secondary">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Unstake</CardTitle>
                <span className="text-xs text-muted-foreground">
                  Available: {unlockedShares !== null ? formatAmount(unlockedShares) : "-"} stQRL
                </span>
              </div>
              <CardDescription>
                Withdrawals unlock after {WITHDRAWAL_DELAY_BLOCKS} blocks (
                {blocksToTime(WITHDRAWAL_DELAY_BLOCKS, BLOCK_TIME_SECONDS)}).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AmountInput
                value={shares}
                onChange={setShares}
                balance={unlockedShares}
                symbol="stQRL"
                disabled={poolStore.tx.state === "pending"}
              />

              {validationError && <p className="text-sm text-red-400">{validationError}</p>}

              <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">You will receive</span>
                  <span className="font-medium">
                    {previewQrl !== null ? `≈ ${formatAmount(previewQrl)} QRL` : "-"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Waiting period</span>
                  <span>{blocksToTime(WITHDRAWAL_DELAY_BLOCKS, BLOCK_TIME_SECONDS)}</span>
                </div>
              </div>

              {poolStore.pool?.paused && (
                <p className="text-sm text-secondary">
                  Withdrawal requests are temporarily paused by the protocol.
                </p>
              )}

              <Button
                className="w-full"
                size="lg"
                disabled={!canRequest}
                onClick={() => void onRequest()}
              >
                <Clock className="h-4 w-4" />
                {poolStore.tx.state === "pending"
                  ? "Waiting for confirmation…"
                  : "Request withdrawal"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Claim */}
        <TabsContent value="claim">
          <Card className="border-l-2 border-l-blue-accent">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl">Claim</CardTitle>
              <CardDescription>
                Requests are claimed oldest-first. Each claim returns the QRL for one request.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {pending.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No pending withdrawal requests.
                </p>
              ) : (
                <ul className="space-y-3">
                  {pending.map((request) => (
                    <li
                      key={request.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3 text-sm"
                    >
                      <div>
                        <p className="font-medium">
                          {formatAmount(request.shares)} stQRL →{" "}
                          {formatAmount(request.qrlPayout)} QRL
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {request.canClaim ? (
                            <span className="text-green-400">Ready to claim</span>
                          ) : request.blocksRemaining > 0n ? (
                            <>
                              Ready in {request.blocksRemaining.toString()} blocks (
                              {blocksToTime(request.blocksRemaining, BLOCK_TIME_SECONDS)})
                            </>
                          ) : (
                            "Waiting for withdrawal reserve"
                          )}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={poolStore.tx.state === "pending"}
                        onClick={() => void poolStore.cancel(request.id)}
                        aria-label={`Cancel request ${request.id}`}
                      >
                        <Undo2 className="h-4 w-4" />
                        Cancel
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <Button
                className="w-full"
                size="lg"
                disabled={claimableCount === 0 || poolStore.tx.state === "pending"}
                onClick={() => void poolStore.claim()}
              >
                <Download className="h-4 w-4" />
                {poolStore.tx.state === "pending"
                  ? "Waiting for confirmation…"
                  : claimableCount > 0
                    ? "Claim oldest request"
                    : "Nothing to claim yet"}
              </Button>

              {account.completedWithdrawalsCount > 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  {account.completedWithdrawalsCount} completed withdrawal
                  {account.completedWithdrawalsCount === 1 ? "" : "s"}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
});
