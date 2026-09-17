import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";

export function LegalPage() {
  return (
    <div className="page-enter mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="text-2xl font-bold">Project status and legal notice</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Native QRL redesign in development
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            This interface is being qualified against a fresh local QRL network.
            A configured contract address and successful local tests do not
            establish readiness for public funds. The app requires explicit
            deployment settings and makes no connection to an older deployment
            by default.
          </p>
          <p>
            The current design records non-transferable native QRL positions
            inside contracts. It creates no transferable staking receipt. Users
            interact directly from their wallets, and native payouts return to
            the position owner. The operator earns a contract-enforced 10% fee
            on eligible net consensus gains realized for payout.
          </p>
        </CardContent>
      </Card>
      <Card className="border-l-2 border-l-identity-accent">
        <CardHeader>
          <CardTitle className="text-lg">
            Operator control and contract immutability
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            The active native contract graph has no owner, upgrader, proxy
            admin, pauser, arbitrary fund rescue, balance setter or mutable fee
            role. Critical contract references and the fee recipient are fixed
            at deployment. The operator cannot replace deployed pool logic,
            change the fee percentage or redirect validator withdrawals to a
            different recipient.
          </p>
          <p>
            The validator operator still controls validator signing and can
            affect validator performance, penalties and execution-tip routing.
            Those operational powers do not provide an administrative path to
            withdraw user principal from the pool. A future protocol version
            requires a separate deployment rather than changing an existing
            pool in place.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Risks and limitations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            Rewards and principal are not guaranteed. Validator penalties,
            losses, protocol failures, unavailable relayers, incorrect bootstrap
            assumptions and software defects can delay withdrawals or reduce
            assets. Execution-tip routing remains controlled by validator
            signing infrastructure.
          </p>
          <p>
            Descriptions of custody controls and deterministic accounting are
            technical statements. They are not legal clearance, a licensing
            determination, investment advice or a claim that any particular
            financial regulation is inapplicable. Public operation requires its
            own legal assessment and applicable disclosures.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Project and source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            QuantaPool is developed by DigitalGuards. Project contact:{" "}
            <a
              href="mailto:info@digitalguards.nl"
              className="text-identity-accent hover:underline"
            >
              info@digitalguards.nl
            </a>
            .
          </p>
          <p>
            The source is available under GPL-3.0 at{" "}
            <a
              href="https://github.com/DigitalGuards/QuantaPool"
              target="_blank"
              rel="noreferrer"
              className="text-identity-accent hover:underline"
            >
              DigitalGuards/QuantaPool
            </a>
            . The license includes warranty limitations. This development notice
            does not replace deployment-specific operator information or terms.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
