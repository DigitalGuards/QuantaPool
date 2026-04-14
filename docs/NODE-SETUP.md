# QuantaPool validator node setup

**Host:** `REDACTED` (Ubuntu 24.04, 32 GB RAM, 1.8 TB disk)
**User:** `qrlnode` (system, nologin, `HOME=/opt/quantapool/node`)
**Stack:** gqrl (execution) + qrysm beacon (consensus). Validator client deferred until we have a keystore + signed deposit.

## Source

- `github.com/theQRL/go-qrl` — built with `make gqrl` on Go 1.25.9
- `github.com/theQRL/qrysm` — `go build ./cmd/{qrysmctl,beacon-chain,validator}`
- Testnet metadata: `github.com/theQRL/go-qrl-metadata/tree/main/testnet/testnetv2`
  - `config.yml` (7-line chain config; `DEPOSIT_CHAIN_ID: 1337`, `DEPOSIT_CONTRACT_ADDRESS: Q4242…`)
  - `genesis.ssz` (4.2 MB; sha256 `c0c3cfa3fbc5df0d873efedfdec6e07ed3152ae439b14a96cfb35069a02a1bde`)

## Filesystem layout

```
/opt/quantapool/node/
  bin/            gqrl, beacon-chain, validator, qrysmctl
  etc/            jwtsecret (0600), config.yml, genesis.ssz
  data/gqrl/      execution chaindata
  data/beacon/    beacon chaindata (boltdb)
  keys/           (empty; will hold encrypted keystores once generated)
  logs/           gqrl.log, beacon.log (systemd appends)
  src/            go-qrl/, qrysm/ (shallow clones for rebuilds)
```

## systemd units

- `/etc/systemd/system/gqrl.service` — starts first, exposes HTTP RPC `127.0.0.1:8545`, authrpc `127.0.0.1:8551`, p2p `:30303`, metrics `172.18.0.1:6060`
- `/etc/systemd/system/qrysm-beacon.service` — `After=gqrl.service`, connects to `http://127.0.0.1:8551` (authrpc, JWT), gRPC `127.0.0.1:4000`, REST gateway `127.0.0.1:3500`, p2p tcp `:13000` / udp `:12000`, metrics `172.18.0.1:8080`
- Two bootstrap nodes hardcoded in the unit (extracted from `qrysm/config/params/mainnet_config.go:40-41`)

Metrics bind to the monitoring docker bridge gateway `172.18.0.1` so Prometheus (on the `monitoring_monitoring` docker network) can scrape without public exposure.

## Prometheus wiring

`/opt/quantapool/monitoring/prometheus/prometheus.yml` has `172.18.0.1:{6060,8080,8081,9100}` in place of the `VALIDATOR_HOST` placeholder. After editing the bind-mounted file, `docker restart quantapool-prometheus` is required (sed inode-swap defeats HUP reload).

Current target state:
- `gqrl`, `beacon-chain`, `contract-exporter`, `prometheus` → up
- `validator`, `node-exporter` → not yet deployed

## Operations

```bash
# status
systemctl status gqrl qrysm-beacon
# logs
tail -f /opt/quantapool/node/logs/{gqrl,beacon}.log
# sync progress
curl -s http://127.0.0.1:8080/metrics | grep -E '^beacon_(head_slot|clock_time_slot)'
# execution RPC
curl -s http://127.0.0.1:8545 -XPOST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"qrl_blockNumber","id":1}'
```

Initial sync took about 15 min CPU time on the 16-core box. After first sync, restart is idempotent.

## Next steps (not done yet)

1. **Generate validator keystore + deposit data offline** (locally, not on this server).
   - `qrysmctl` subcommand to derive from a 34-word ML-DSA-87 mnemonic.
   - Outputs `deposit_data-*.json` (pubkey, withdrawal_credentials, signature, deposit_data_root) + encrypted keystore JSON.
   - **Critical:** `withdrawal_credentials = 0x00 + 11-zero + <pool-address>` (the `0x00` fix is already live in v2.1 pool bytecode).
2. Copy keystore + password file to `/opt/quantapool/node/keys/` (0700), import into validator data dir with `validator accounts import`.
3. Start `qrysm-validator.service` (unit not yet written — add `--beacon-rpc-provider=127.0.0.1:4000`, `--wallet-dir`, `--wallet-password-file`).
4. Submit deposit via QuantaPool `pool.fundValidator(pubkey, creds, sig, root)` — the on-chain path that has never been exercised before.
5. Wait for the beacon to see the deposit (activation queue), then the validator starts signing.
