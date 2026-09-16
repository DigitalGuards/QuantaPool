# QuantaPool native QRL interface

React, TypeScript, MobX and Vite interface for the native QRL pool. Deposits, internal positions, rewards, queued requests and cash claims use native QRL. There is no transferable staking receipt or approval flow.

## Development

```sh
npm ci
npm run test
npm run lint
npm run typecheck
npm run build
npm run dev -- --host 127.0.0.1
```

Create an ignored `.env.local` with `VITE_RPC_URL`, `VITE_CHAIN_ID` and `VITE_NATIVE_POOL_ADDRESS` for the intended fresh deployment. The pool address must be a native 64-byte QIP-55 address. Optional settings are `VITE_EXPLORER_URL`, `VITE_DEPLOYMENT_BLOCK`, `VITE_NETWORK_NAME`, `VITE_NETWORK_LABEL`, and `VITE_NETWORK=TEST_NET` or `MAIN_NET`. The network selector is descriptive; the explicit chain ID is authoritative. No RPC, explorer or contract address is supplied by default. An unconfigured build displays the development interface and disables transaction entry.

The read RPC must report the configured chain ID. Before each send, the wallet must report that same chain through `qrl_chainId`. The transaction includes the expected chain ID. The app requires deployed pool code and the expected fixed fee policy. Deployment operators must independently verify the configured contract and immutable dependencies; UI checks are not a code audit or consensus proof.

Both wallet transports receive explicit gas limits after a successful RPC estimate. Normal accounting calls use the estimate plus 30%, rounded up. Deposits, pending refunds, reserved claims and recovery claims also receive 100,000 gas for next-block cash-flow history growth, with a 300,000-gas minimum. The app rejects a buffered limit above the current block limit and rechecks wallet identity and chain before requesting a send. Estimation failures stop preparation; failed transactions are never automatically retried.

## Native actions

| Action                       | Native pool call                                            |
| ---------------------------- | ----------------------------------------------------------- |
| Deposit                      | `deposit()` with native value                               |
| Request QRL                  | `requestWithdrawal(amount)`                                 |
| Request earnings             | `requestRewards(amount)`                                    |
| Request full value           | Either request with the contract's maximum-uint256 sentinel |
| Claim reserved cash          | `claim()`                                                   |
| Cancel queued request        | `cancelRequest()`                                           |
| Refund unadmitted deposit    | `cancelPending(id)`                                         |
| Claim after permanent expiry | `claimRecovery()`                                           |

Positions show remaining principal basis, current staked value, unreserved earnings, principal shortfall, pending deposits and claimable cash. Earnings remain exposed to losses until reservation. Requests wait for a future authenticated cutoff and strict FIFO liquidity allocation. Protocol eligibility and validator returns determine waiting time. There is no fixed countdown or promised APR.

The immutable 10% operator fee applies to eligible net consensus gains at payout reservation. Gifts, outside top-ups and principal are excluded, and losses constrain eligibility. Execution-tip routing remains operator-controlled, so receipt of every tip is not guaranteed. Recovery estimates show currently distributable cash; later returns remain claimable under frozen positions.

Wallet discovery, extension signing and the MyQRLWallet encrypted relay, QR, deep-link, reconnect and disconnect flows are retained. Only native QIP-55 accounts authorize transactions. Optional explorer links are omitted when no explorer is configured. Event history depends on RPC log availability; the owner can supply a pending deposit ID directly for refunds when history cannot be fetched. The latest 64 pending-deposit event IDs are shown.

`src/abi/NativeQrlPool.ts` is generated from the pinned compiler's `build/native/NativeQrlPool.abi`. After compiling native contracts from the repository root, run `npm run abi:sync` in this directory and review the generated change. No older contract ABI or deployment address is required.

Automated utility tests cover exact amount conversion, full-request semantics, loss display, chain ID validation, QIP-55 accounts and relay lifecycle guards. Production readiness and live consensus behavior require the separate contract proof and network tests. This frontend is not publicly deployed by these commands.

Native event reads use explicit 64-byte `qrl_getLogs` topics and the native ABI decoder. Signature hashes occupy the high 32 bytes with trailing zero padding; indexed beneficiaries retain all 64 address bytes. This bypasses the SDK event wrapper's narrower filter validation without modifying the SDK or node. Returned events are checked against the configured pool and full beneficiary before decoding.
