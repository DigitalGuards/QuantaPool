export type NativeWalletTransport = "extension" | "relay";

export interface NativeEstimateRequest {
  from: string;
  to: string;
  value: bigint;
  data: string;
}

export interface NativeWalletRequest extends NativeEstimateRequest {
  chainId: bigint;
  transport: NativeWalletTransport;
  cashFlow: boolean;
}

export interface NativeGasReader {
  estimateGas: (transaction: NativeEstimateRequest) => Promise<bigint>;
  blockGasLimit: () => Promise<bigint>;
}

// NativeLedger._writeFlow appends a two-slot FlowPoint and updates the array
// length when execution advances to another block. The pinned compiler packs
// executionBlock and externalDeposits together; cashPayments uses the next
// native 64-byte slot. A same-block estimate can omit these append costs.
const CASH_FLOW_GAS_MARGIN = 100_000n;
const CASH_FLOW_GAS_FLOOR = 300_000n;

export function nativeGasLimit(
  estimate: bigint,
  blockLimit: bigint,
  cashFlow: boolean,
): bigint {
  if (typeof estimate !== "bigint" || estimate <= 0n)
    throw new Error("The RPC returned an invalid gas estimate.");
  if (typeof blockLimit !== "bigint" || blockLimit <= 0n)
    throw new Error("The RPC returned an invalid block gas limit.");
  let gas = (estimate * 130n + 99n) / 100n;
  if (cashFlow) {
    gas += CASH_FLOW_GAS_MARGIN;
    if (gas < CASH_FLOW_GAS_FLOOR) gas = CASH_FLOW_GAS_FLOOR;
  }
  if (gas > blockLimit)
    throw new Error(
      "The buffered transaction exceeds the current block gas limit.",
    );
  if (gas > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("The gas limit exceeds supported wallet precision.");
  return gas;
}

/** Both wallet transports receive the same estimated, bounded gas allowance. */
export async function prepareNativeWalletRequest(
  request: NativeWalletRequest,
  reader: NativeGasReader,
): Promise<Record<string, unknown>> {
  const { from, to, value, data, chainId, transport, cashFlow } = request;
  const [estimate, blockLimit] = await Promise.all([
    reader.estimateGas({ from, to, value, data }),
    reader.blockGasLimit(),
  ]);
  const gas = nativeGasLimit(estimate, blockLimit, cashFlow);
  const common = { from, to, data, chainId: `0x${chainId.toString(16)}` };
  if (transport === "relay") {
    return {
      ...common,
      gas: `0x${gas.toString(16)}`,
      ...(value > 0n ? { value: `0x${value.toString(16)}` } : {}),
    };
  }
  return {
    ...common,
    value: value.toString(),
    gas: Number(gas),
    gasLimit: Number(gas),
    type: "0x2",
  };
}
