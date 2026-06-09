import { Input } from "@/components/UI/Input";
import { Button } from "@/components/UI/Button";
import { formatUnits } from "@/utils/format";

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Balance in base units used by the Max / percentage buttons. */
  balance: bigint | null;
  symbol: string;
  disabled?: boolean;
}

const PERCENTAGES = [25, 50, 75] as const;

/** Numeric amount input with the wallet's 25/50/75/Max quick buttons. */
export function AmountInput({ value, onChange, balance, symbol, disabled }: AmountInputProps) {
  const setFraction = (percent: number) => {
    if (balance === null) return;
    const amount = (balance * BigInt(percent)) / 100n;
    onChange(formatUnits(amount));
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          inputMode="decimal"
          placeholder="0.0"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value.replace(",", ".");
            if (next === "" || /^\d*\.?\d*$/.test(next)) onChange(next);
          }}
          className="h-12 pr-16 text-lg"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
          {symbol}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {PERCENTAGES.map((percent) => (
          <Button
            key={percent}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || balance === null}
            onClick={() => setFraction(percent)}
          >
            {percent}%
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || balance === null}
          onClick={() => setFraction(100)}
        >
          Max
        </Button>
      </div>
    </div>
  );
}
