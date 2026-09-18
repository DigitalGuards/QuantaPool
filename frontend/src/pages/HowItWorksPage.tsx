import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";

const sections = [
  [
    "1. Deposit native QRL",
    "Your wallet sends QRL directly to the pool contract. The deposit stays pending and refundable until a later authenticated checkpoint admits it. A new position receives no earnings or losses from before admission. No transferable staking receipt exists.",
  ],
  [
    "2. Fund native validators",
    "QRL validators use 40,000 QRL. The validator bootstrapper first supplies its own 2,000 QRL. The immutable gate authenticates the canonical pool withdrawal recipient and publishes a valid signed exit before admitting that capital and releasing the remaining 38,000 QRL atomically. The pool retains a liquidity buffer. Unfinished bootstrap capital can remain locked under the native protocol.",
  ],
  [
    "3. Account for earnings and losses",
    "Complete finalized portfolio proofs connect validator balances, deposits, withdrawals and the pool execution account. Internal, non-transferable accounting shares spread changes across positions without iterating over users. Principal and unreserved earnings bear losses. Cash gifts and outside validator top-ups are fee-exempt.",
  ],
  [
    "4. Request rewards or withdraw",
    "Request a QRL amount or the full position. Reward requests draw from earnings above remaining contributed principal basis. All requests enter one deterministic FIFO queue and settle after a future authenticated cutoff. Available cash is reserved first. A request which needs more liquidity waits for validator returns and stays exposed to rewards and losses until reservation.",
  ],
  [
    "5. Claim QRL and pay the earned fee",
    "Once cash is reserved, claim it directly to the wallet which owns the position. The immutable fee is 10% of eligible net consensus gains at reservation, with prior losses, fee-exempt contributions and fractional fee carry accounted for. Principal is excluded. Only earned fee reserves can be paid to the fixed operator recipient.",
  ],
  [
    "6. Independent exits and recovery",
    "Each pool admits at most 64 validators over its lifetime. An immutable operator address authorizes new validator preparations. Signed validator exits are stored publicly before pooled top-up funding. An independent relayer can submit them when the unmodified protocol permits. Anyone holding a public signature can also force an eligible early exit, reducing validation uptime. Each replacement validator uses another lifetime admission. This public-exit policy remains subject to review before launch. Eligibility, inclusion and validator withdrawal timing still apply. If finality verification or complete pool accounting exceeds its immutable deadline, anyone can trigger recovery: pending deposit refunds and reserved claims remain payable, and frozen positions receive their share of available and later returned cash without new fees.",
  ],
] as const;

export function HowItWorksPage() {
  return (
    <div className="page-enter mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="text-2xl font-bold">How native pooled staking works</h1>
      <p className="text-muted-foreground">
        Your position is recorded inside immutable contracts. You deposit and
        receive native QRL.
      </p>
      {sections.map(([title, text]) => (
        <Card key={title}>
          <CardHeader>
            <CardTitle className="text-lg">{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {text}
            </p>
          </CardContent>
        </Card>
      ))}
      <Card className="border-l-2 border-l-identity-accent">
        <CardHeader>
          <CardTitle className="text-lg">Immutable by construction</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            The native contract graph has no owner, upgrader, proxy admin,
            pauser, arbitrary fund rescue, balance setter or mutable fee role.
            Critical contract references and the fee recipient are fixed at
            deployment. The operator cannot replace the pool implementation,
            change the fee percentage or redirect validator withdrawals to a
            different recipient.
          </p>
          <p>
            Validator operation is still an operator responsibility. Validator
            signing can affect performance, losses and execution-tip routing,
            but consensus withdrawals are bound to the pool contract. A future
            QuantaPool version requires a separate deployment. Existing deployed
            code does not become a new version automatically.
          </p>
        </CardContent>
      </Card>
      <Card className="border-l-2 border-l-secondary">
        <CardHeader>
          <CardTitle className="text-lg">
            Trust and availability limits
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            The finality verifier starts from an independently reviewed
            bootstrap checkpoint and the intended network's signing domain. It
            checks committee signatures and state proofs within fixed fork and
            recovery-window rules. Committee security, bootstrap correctness and
            timely proof submission remain assumptions. RPC data alone is not
            contract authentication.
          </p>
          <p>
            The validator signing key controls consensus participation and
            execution-tip routing. Withdrawal credentials bind native consensus
            withdrawals to the pool, but receipt of every execution tip cannot
            be guaranteed. There is no promise covering tips routed elsewhere.
          </p>
          <p>
            Permissionless execution still needs someone to provide valid
            proofs, process batches and relay exits. Operator disappearance can
            delay progress. Permanent recovery distributes cash as it becomes
            available; it cannot guarantee validator liveness, a recovery date
            or principal repayment.
          </p>
          <p>
            The pool has no owner balance setter, arbitrary asset rescue,
            beneficiary override, upgrade authority or discretionary payout
            selector. It has no lending, leverage, rehypothecation or
            operator-selected investment strategy. These technical constraints
            do not establish a regulatory classification or legal approval.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
