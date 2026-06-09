import { useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { Zap } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { AmountInput } from "@/components/AmountInput";
import { StatsBar } from "@/components/StatsBar";
import { useStore } from "@/stores/store";
import { formatAmount, formatRate, formatUsd, parseUnits } from "@/utils/format";

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "What is QuantaPool?",
    answer:
      "QuantaPool is a decentralized liquid staking protocol for the QRL network. You deposit QRL into the pool, the pool funds validators (40,000 QRL each), and validator rewards flow back to all stakers automatically.",
  },
  {
    question: "What is stQRL?",
    answer:
      "stQRL is a fixed-balance liquid staking token. Your share balance stays constant while the QRL value of each share grows as the pool earns rewards. You can transfer stQRL freely while your underlying stake keeps earning.",
  },
  {
    question: "How do rewards work?",
    answer:
      "Rewards are detected trustlessly from validator balance increases — no oracle involved. They raise the stQRL/QRL exchange rate, so the QRL value of your shares increases over time. The protocol currently charges no fees.",
  },
  {
    question: "How do I unstake?",
    answer:
      "Request a withdrawal on the Withdrawals page. Your shares are locked and, after a 128-block delay (about 2 hours), you can claim your QRL. You can cancel a pending request at any time before claiming.",
  },
  {
    question: "Is it post-quantum secure?",
    answer:
      "Yes. QRL uses the Dilithium ML-DSA-87 signature scheme, which is designed to resist attacks from quantum computers. QuantaPool validators and all transactions inherit this protection.",
  },
  {
    question: "What are the risks?",
    answer:
      "Smart-contract risk and validator slashing risk. Slashing losses are socialized: the exchange rate drops proportionally for all holders rather than wiping out individual stakers. The contracts are covered by an extensive Foundry test suite.",
  },
];

export const StakePage = observer(() => {
  const { poolStore } = useStore();
  const [amount, setAmount] = useState("");

  const pool = poolStore.pool;
  const account = poolStore.account;

  const parsedAmount = useMemo(() => {
    if (!amount) return null;
    try {
      return parseUnits(amount);
    } catch {
      return null;
    }
  }, [amount]);

  const stakeBalance = poolStore.stakeableBalance;

  const validationError = useMemo(() => {
    if (!account || !amount) return null;
    if (parsedAmount === null) return "Enter a valid amount";
    if (parsedAmount === 0n) return null;
    if (pool && parsedAmount < pool.minDeposit) {
      return `Minimum deposit is ${formatAmount(pool.minDeposit)} QRL`;
    }
    if (parsedAmount > account.qrlBalance) return "Insufficient QRL balance";
    return null;
  }, [account, amount, parsedAmount, pool]);

  const previewShares =
    parsedAmount !== null && parsedAmount > 0n ? poolStore.sharesForQrl(parsedAmount) : null;

  const canStake =
    !!account &&
    parsedAmount !== null &&
    parsedAmount > 0n &&
    !validationError &&
    poolStore.tx.state !== "pending" &&
    !(pool?.paused ?? false);

  const onStake = async () => {
    if (!canStake) return;
    const ok = await poolStore.stake(amount);
    if (ok) setAmount("");
  };

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="relative pt-10 pb-2 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-16 h-64 bg-[radial-gradient(ellipse_at_top,hsl(25_95%_53%/0.10),transparent_65%)]"
        />
        <h1 className="text-3xl font-black tracking-tight md:text-5xl">
          Liquid staking for <span className="text-secondary">QRL</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Stake QRL, receive stQRL, and earn validator rewards automatically — secured by
          post-quantum cryptography.
        </p>
      </section>

      {/* Stake widget */}
      <section className="mx-auto max-w-md space-y-4">
        <Card className="border-l-2 border-l-secondary">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">Stake</CardTitle>
              {account && (
                <span className="text-xs text-muted-foreground">
                  Balance: {formatAmount(account.qrlBalance)} QRL
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <AmountInput
              value={amount}
              onChange={setAmount}
              balance={stakeBalance}
              symbol="QRL"
              disabled={poolStore.tx.state === "pending"}
            />

            {validationError && (
              <p className="text-sm text-red-400">{validationError}</p>
            )}

            <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">You will receive</span>
                <span className="font-medium">
                  {previewShares !== null ? `≈ ${formatAmount(previewShares)} stQRL` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Exchange rate</span>
                <span>{pool ? `1 stQRL = ${formatRate(pool.exchangeRate)} QRL` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Minimum deposit</span>
                <span>{pool ? `${formatAmount(pool.minDeposit)} QRL` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Protocol fee</span>
                <span>None</span>
              </div>
            </div>

            {pool?.paused && (
              <p className="text-sm text-secondary">
                Deposits are temporarily paused by the protocol.
              </p>
            )}

            {account ? (
              <Button className="w-full" size="lg" disabled={!canStake} onClick={() => void onStake()}>
                <Zap className="h-4 w-4" />
                {poolStore.tx.state === "pending" ? "Waiting for confirmation…" : "Stake QRL"}
              </Button>
            ) : (
              <Button
                className="w-full"
                size="lg"
                disabled={poolStore.isConnecting}
                onClick={() => void poolStore.connect()}
              >
                {poolStore.isConnecting ? "Connecting…" : "Connect wallet to stake"}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Position */}
        {account && (
          <Card className="border-l-2 border-l-blue-accent">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Your position</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">stQRL balance</span>
                <span className="font-medium">{formatAmount(account.shares)} stQRL</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current value</span>
                <span className="font-medium">
                  {formatAmount(account.qrlValue)} QRL
                  {(() => {
                    const usd = poolStore.usdValue(account.qrlValue);
                    return usd !== null ? (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ≈ {formatUsd(usd)}
                      </span>
                    ) : null;
                  })()}
                </span>
              </div>
              {account.lockedShares > 0n && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Locked in withdrawals</span>
                  <Link to="/withdrawals" className="text-blue-accent hover:underline">
                    {formatAmount(account.lockedShares)} stQRL
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="mx-auto max-w-3xl">
        <StatsBar />
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl pb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">FAQ</h2>
          <Link to="/how-it-works" className="text-sm text-blue-accent hover:underline">
            Read the full guide →
          </Link>
        </div>
        <div className="divide-y divide-border/60 rounded-lg border">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="group p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
                {item.question}
                <span className="ml-4 text-muted-foreground transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
});
