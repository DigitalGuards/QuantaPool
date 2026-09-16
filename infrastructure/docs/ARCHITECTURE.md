# Native pool infrastructure boundaries

The pool has four immutable core contracts and an optional immutable checkpoint batching helper. See the [contract architecture](../../docs/architecture.md) for authoritative economic rules.

| Process | Required capability | Failure effect |
|---|---|---|
| Unmodified execution and beacon nodes | Supply canonical blocks, state and native account proofs | Missing data delays proof submission; unauthenticated RPC output cannot change accounting |
| Preparation account | Authorize new validator keys with its own 2,000 QRL capital | Immutable identity; compromise affects future consensus-key selection, while disappearance stops new preparations |
| Validator signer | Perform native consensus duties and provide a public exit before pooled funding | Downtime and slashing affect returns; execution-tip routing remains operator-controlled |
| Proof builder and keeper | Read public data, verify witnesses, pay for permissionless contract calls | Anyone with data and gas can replace it; missed trust deadlines permanently enter recovery |
| Independent exit relay | Retrieve the stored signed exit and submit it under native eligibility rules | An available signed message removes further signer cooperation for the supported fork; eligibility and network inclusion still control timing |
| Frontend | Read positions and prepare user-authorized native contract calls | Users retain direct contract access if the site disappears |
| Monitoring | Read contracts at one execution block and export approximate metrics | Monitoring failure affects visibility only |

No operator process receives user principal or consensus withdrawal proceeds in an EOA. Validator funding passes atomically through the immutable gate to the pinned canonical deposit contract. Consensus withdrawals use the pool recipient authenticated before funding. The operator's own preparation capital remains a separate risk before adoption.

Local tests use the [reviewed source lock](../../native/network/source-lock.json). Published node images and historical provisioning commands are not evidence that a deployment uses those sources. The local harness verifies actual Docker loopback mappings, execution and beacon identities, canonical deposit runtime and compiler provenance.

Hosted RPC access, historical block availability, proof-building capacity and gas funding are liveness dependencies. Sampled committee honesty, the initial checkpoint and supported fork policy are verifier trust assumptions. None is replaced by a monitoring alert or agreement between RPC servers.
