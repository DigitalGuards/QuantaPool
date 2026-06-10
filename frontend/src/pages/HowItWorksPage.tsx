import { Link } from "react-router-dom";
import {
  ArrowDownToLine,
  Clock,
  Coins,
  Landmark,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { BLOCK_TIME_SECONDS, WITHDRAWAL_DELAY_BLOCKS } from "@/config/networks";
import { blocksToTime } from "@/utils/format";

function Section({
  icon: Icon,
  title,
  children,
  accent = "secondary",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  accent?: "secondary" | "blue";
}) {
  return (
    <Card
      className={
        accent === "secondary" ? "border-l-2 border-l-secondary" : "border-l-2 border-l-blue-accent"
      }
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon
            className={accent === "secondary" ? "h-5 w-5 text-secondary" : "h-5 w-5 text-blue-accent"}
          />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

const WITHDRAWAL_STEPS = [
  {
    title: "Request",
    description:
      "You choose how much stQRL to unstake. Those shares are locked (they can't be transferred) and the QRL value is snapshotted at that moment, so a later rate change can't reduce what you'll receive.",
  },
  {
    title: `Wait ${WITHDRAWAL_DELAY_BLOCKS} blocks (${blocksToTime(WITHDRAWAL_DELAY_BLOCKS, BLOCK_TIME_SECONDS)})`,
    description:
      "A protocol-enforced security delay. You can cancel at any point during the wait and your shares unlock immediately.",
  },
  {
    title: "Claim",
    description:
      "Once the delay has passed and the withdrawal reserve is funded, claim your QRL. Requests are paid out oldest-first; your locked shares are burned and the QRL lands in your wallet.",
  },
];

export function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-bold">How QuantaPool works</h1>
        <p className="mt-2 text-muted-foreground">
          A plain-language guide to liquid staking on the QRL network.
        </p>
      </div>

      <Section icon={Coins} title="The problem QuantaPool solves">
        <p>
          Running your own QRL validator requires 40,000 QRL and a server that stays online
          around the clock. QuantaPool pools deposits from many stakers, runs the validators for
          you, and shares the rewards, so you can stake any amount above the minimum and stay
          liquid the whole time.
        </p>
      </Section>

      <Section icon={Wallet} title="Step 1: Stake QRL, receive stQRL">
        <p>
          When you deposit QRL into the pool you receive <strong>stQRL</strong>, a token that
          represents your share of everything the pool holds. Deposits go into a buffer, and every
          time the buffer reaches 40,000 QRL the pool funds a new validator.
        </p>
        <p>
          stQRL is a <strong>fixed-balance</strong> token: your share count stays constant (which
          keeps accounting and taxes simple), while the <em>QRL value</em> of each share grows as
          rewards come in. You can hold, transfer, or eventually trade stQRL like any other token.
          Your underlying stake keeps earning either way.
        </p>
      </Section>

      <Section icon={TrendingUp} title="Step 2: Rewards grow the exchange rate" accent="blue">
        <p>
          Validators earn rewards for proposing and attesting blocks. Those rewards flow back to
          the pool and raise the <strong>stQRL → QRL exchange rate</strong>. Example: you stake
          1,000 QRL at a rate of 1.00 and receive 1,000 stQRL. A year later the rate is 1.05,
          and your same 1,000 stQRL is now worth 1,050 QRL.
        </p>
        <p>
          Reward detection is <strong>trustless</strong>: the contract reads its own balance
          increases on-chain instead of relying on a price oracle or an operator's word. Anyone
          can trigger a reward sync. The protocol currently takes <strong>no fee</strong>: 100%
          of rewards go to stakers.
        </p>
      </Section>

      <Section icon={Clock} title="Step 3: Unstake whenever you want">
        <p>
          Fresh deposits mature for about a day (1536 blocks) before they can be unstaked or
          transferred, as protection against deposit/withdraw griefing. Top-up deposits fold any
          not-yet-matured shares into a new bucket and restart that timer for that portion only.
        </p>
        <ol className="space-y-3">
          {WITHDRAWAL_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-xs font-bold text-secondary">
                {index + 1}
              </span>
              <div>
                <p className="font-medium text-foreground">{step.title}</p>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section icon={Landmark} title="Where your QRL actually goes" accent="blue">
        <p>Pooled QRL only ever sits in three places, all visible on-chain:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Validators</strong>: 40,000 QRL each, staked on the QRL beacon chain earning
            rewards.
          </li>
          <li>
            <strong>Buffer</strong>: deposits accumulating toward the next validator.
          </li>
          <li>
            <strong>Withdrawal reserve</strong>: QRL set aside to pay out pending withdrawal
            requests.
          </li>
        </ul>
        <p>
          You can audit all three at any time on the <Link to="/stats" className="text-blue-accent hover:underline">Stats page</Link> or
          directly on the block explorer.
        </p>
      </Section>

      <Section icon={ShieldCheck} title="Security model">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Post-quantum signatures.</strong> QRL uses Dilithium ML-DSA-87, designed to
            withstand quantum computers. Everything QuantaPool does inherits that protection.
          </li>
          <li>
            <strong>Slashing is socialized.</strong> If a validator is penalized, the loss lowers
            the exchange rate slightly for everyone instead of wiping out unlucky individuals.
          </li>
          <li>
            <strong>No oracle, no custody middlemen.</strong> Rewards are detected from on-chain
            balance changes; your stQRL is yours, in your own wallet.
          </li>
          <li>
            <strong>Tested contracts.</strong> The protocol ships with an extensive Foundry suite
            (200+ tests) covering deposits, withdrawals, reward sync, and slashing scenarios.
          </li>
        </ul>
        <p>
          Like all DeFi, smart-contract risk is never zero. Never stake more than you can afford
          to lock up.
        </p>
      </Section>

      <Section icon={RefreshCcw} title="QuantaPool and MyQRLWallet" accent="blue">
        <p>
          QuantaPool is built by the team behind{" "}
          <a
            href="https://qrlwallet.com"
            target="_blank"
            rel="noreferrer"
            className="text-blue-accent hover:underline"
          >
            MyQRLWallet
          </a>
          . Today you connect with the QRL Wallet browser extension; staking directly from the
          MyQRLWallet mobile app via the wallet-connect bridge is on the roadmap, so your stQRL
          will show up right next to your QRL.
        </p>
      </Section>

      <div className="flex justify-center pt-2 pb-6">
        <Button size="lg" asChild>
          <Link to="/">
            <ArrowDownToLine className="h-4 w-4" />
            Start staking
          </Link>
        </Button>
      </div>
    </div>
  );
}
