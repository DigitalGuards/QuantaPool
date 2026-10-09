import { NativeQrlPoolABI } from "../../abi/NativeQrlPool.ts";
import type { Web3Instance } from "./web3Lazy.ts";

export interface ContractCall {
  call(): Promise<unknown>;
  encodeABI(): string;
}

export interface NativePoolMethods {
  deposit(): ContractCall;
  requestWithdrawal(amount: bigint): ContractCall;
  requestRewards(amount: bigint): ContractCall;
  claim(): ContractCall;
  claimRecovery(): ContractCall;
  beginRecovery(): ContractCall;
  cancelPending(id: bigint): ContractCall;
  cancelRequest(): ContractCall;
  riskAssets(): ContractCall;
  freeCash(): ContractCall;
  claimReserve(): ContractCall;
  pendingTotal(): ContractCall;
  feeReserve(): ContractCall;
  FEE_BPS(): ContractCall;
  minDeposit(): ContractCall;
  lastCheckpointBlock(): ContractCall;
  recovering(): ContractCall;
  poolStatus(): ContractCall;
  poolRecoveryDeadlineSlot(): ContractCall;
  stage(): ContractCall;
  pendingHead(): ContractCall;
  queueHead(): ContractCall;
  totalShares(): ContractCall;
  recoveryPaid(): ContractCall;
  frozenShares(): ContractCall;
  getPosition(address: string): ContractCall;
  positionValue(address: string): ContractCall;
  rewardValue(address: string): ContractCall;
  claimable(address: string): ContractCall;
  getPending(id: bigint): ContractCall;
  getRequest(id: bigint): ContractCall;
}

/**
 * Keep ABI method inference and expose call results as unknown so consumers
 * validate every response field before using it.
 */
export function nativePoolMethods(
  web3: { qrl: Pick<Web3Instance["qrl"], "Contract"> },
  address: string,
): NativePoolMethods {
  const contract = new web3.qrl.Contract(NativeQrlPoolABI, address);
  return contract.methods;
}
