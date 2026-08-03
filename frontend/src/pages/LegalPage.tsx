import { Building2, Code2, FlaskConical, Scale, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";

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

export function LegalPage() {
  return (
    <div className="page-enter mx-auto max-w-3xl space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-bold">Legal notice</h1>
        <p className="mt-2 text-muted-foreground">
          What QuantaPool is, what it is not, and who is behind it. Last updated: 14 July 2026.
        </p>
      </div>

      <Section icon={FlaskConical} title="Testnet only, no monetary value">
        <p>
          The QuantaPool contracts (stQRL, DepositPool, ValidatorManager) are deployed exclusively
          on the QRL 2.0 (Zond) testnet. Testnet QRL and stQRL are test assets with no monetary
          value: they cannot be bought or sold for money and represent no claim on anyone. Every
          deposit, reward, and withdrawal shown on this site involves test assets only; no real
          funds are involved anywhere.
        </p>
        <p>
          stQRL is a valueless test token minted by an experimental testnet contract. It is not
          offered to the public as a crypto-asset. QRL 2.0 has no mainnet yet, and QuantaPool is
          not deployed on any mainnet. If a mainnet deployment happens in the future, it will be
          announced separately and will operate under its own terms, structure, and documentation.
        </p>
      </Section>

      <Section icon={Scale} title="No services are provided" accent="blue">
        <p>
          QuantaPool is free, experimental, open-source software: an interface to testnet smart
          contracts that you interact with directly from your own wallets. DigitalGuards never
          holds, controls, or transmits your assets, does not operate a staking service for assets
          of value, and charges no fees or commission.
        </p>
        <p>
          Because everything here is limited to valueless test assets, no crypto-asset services
          within the meaning of Regulation (EU) 2023/1114 (MiCA) are provided, and nothing on this
          site is an offer, solicitation, or recommendation to buy, sell, or stake any
          crypto-asset, nor investment, legal, or tax advice. Displayed exchange rates and rewards
          describe testnet contract state, not returns on an investment.
        </p>
      </Section>

      <Section icon={ShieldAlert} title="No warranty, use at your own risk">
        <p>
          This site and the underlying contracts are provided as-is and as-available, without
          warranties of any kind, in line with sections 15 and 16 of the GPL-3.0 license. This is
          experimental software under active development; expect bugs, resets, and breaking
          changes. To the maximum extent permitted by law, DigitalGuards accepts no liability for
          any loss or damage arising from its use.
        </p>
      </Section>

      <Section icon={Code2} title="Open source" accent="blue">
        <p>
          QuantaPool is open source under the GPL-3.0 license. The contracts, tests, and this
          frontend are published at{" "}
          <a
            href="https://github.com/DigitalGuards/QuantaPool"
            target="_blank"
            rel="noreferrer"
            className="text-blue-accent hover:underline"
          >
            github.com/DigitalGuards/QuantaPool
          </a>
          .
        </p>
      </Section>

      <Section icon={Building2} title="Provider">
        <p>
          This site is operated by DigitalGuards, a sole proprietorship (eenmanszaak) registered
          in the Netherlands, Chamber of Commerce (KvK) number 91987482. Contact:{" "}
          <a href="mailto:info@digitalguards.nl" className="text-blue-accent hover:underline">
            info@digitalguards.nl
          </a>
          . The full imprint and the legal documents for the MyQRLWallet products are published
          at{" "}
          <a
            href="https://qrlwallet.com/legal"
            target="_blank"
            rel="noreferrer"
            className="text-blue-accent hover:underline"
          >
            qrlwallet.com/legal
          </a>
          .
        </p>
      </Section>
    </div>
  );
}
