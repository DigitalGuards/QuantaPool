# Native QuantaPool monitoring

The contract exporter reads the native pool and its immutable finality and portfolio bindings at one execution block. It holds no signing keys and cannot report balances, assign rewards, release funds or control withdrawals. No transferable staking receipt exists.

Set `QRL_RPC_URL`, `QRL_CHAIN_ID` and `NATIVE_POOL_ADDRESS` explicitly. There are no old testnet address defaults. Run `npm ci && npm start` inside `contract-exporter/`. The HTTP listener defaults to loopback; container configuration selects its internal bind explicitly. `/health` fails when complete scrapes stop. `/metrics` exposes cash reserves, risk assets, pending deposits, earned fees, validator count, authenticated slots, pool-specific recovery deadlines and irreversible recovery status. Healthy finality can coexist with expired pool accounting; the exporter reports both statuses independently.

QRL metrics are approximate Prometheus floating-point observations. Exact economic amounts remain on chain as integers. Monitoring never supplies a trust anchor or substitutes for finality proofs. The dashboard and alerts track the native ABI; old token pricing and supply metrics are removed.

The optional surrounding infrastructure templates require explicit fresh deployment inputs. Updating these files does not deploy or change a remote service. Native nodes must use the unchanged revisions qualified for that deployment.

Prometheus, Alertmanager and the exporter publish host ports on loopback. Containers communicate through the monitoring network. Grafana retains its configured dashboard port; restrict dashboard access and supply a strong administrator password for each deployment.

`ContractExporterDown` detects an unreachable exporter or an absent scrape target, including startup failures before any successful contract read. `NativePoolMetricsStale` also detects a reachable target with missing completion metrics or an old successful sample. Validate the alert timing and recovery cases with `sh monitoring/test-rules.sh` from the repository root. The runner uses an installed `promtool`, or the same Prometheus image version as the Compose stack in a temporary container with networking disabled.
