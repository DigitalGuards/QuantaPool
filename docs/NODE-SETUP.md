# QuantaPool validator node setup

**Host:** `REDACTED` (Ubuntu 24.04, 32 GB RAM, 1.8 TB disk)
**User:** `qrlnode` (system, nologin, `HOME=/opt/quantapool/node`)
**Stack:** gqrl (execution) + qrysm beacon (consensus) + qrysm validator. As of 2026-04-14 all three are running under systemd; one validator key is imported and waiting for activation after the on-chain deposit (`pool.fundValidator()` tx `0x61d6f48c…`).

## Source

- `github.com/theQRL/go-qrl` — built with `make gqrl` on Go 1.25.9
- `github.com/theQRL/qrysm` — `go build ./cmd/{qrysmctl,beacon-chain,validator,staking-deposit-cli/deposit}`. Note the deposit CLI's `main.go` lives one level deeper at `cmd/staking-deposit-cli/deposit/main.go`.
- Testnet metadata: `github.com/theQRL/go-qrl-metadata/tree/main/testnet/testnetv2`
  - `config.yml` (7-line chain config; `DEPOSIT_CHAIN_ID: 1337`, `DEPOSIT_CONTRACT_ADDRESS: Q4242…`)
  - `genesis.ssz` (4.2 MB; sha256 `c0c3cfa3fbc5df0d873efedfdec6e07ed3152ae439b14a96cfb35069a02a1bde`)

## Filesystem layout

```
/opt/quantapool/node/
  bin/            gqrl, beacon-chain, validator, qrysmctl, staking-deposit-cli
  etc/            jwtsecret (0600), config.yml, genesis.ssz,
                  validator-password (0600), validator-mnemonic.txt (0600)
  data/gqrl/      execution chaindata
  data/beacon/    beacon chaindata (boltdb)
  data/validator/ wallet/, validator.db (slashing protection — back this up before
                  ever moving the keystore!)
  keys/validator_keys/  deposit_data-*.json + keystore-*.json (0700)
  logs/           gqrl.log, beacon.log, validator.log (systemd appends)
  src/            go-qrl/, qrysm/ (shallow clones for rebuilds)
```

## systemd units

- `/etc/systemd/system/gqrl.service` — starts first, exposes HTTP RPC `127.0.0.1:8545`, authrpc `127.0.0.1:8551`, p2p `:30303`, metrics `172.18.0.1:6060`
- `/etc/systemd/system/qrysm-beacon.service` — `After=gqrl.service`, connects to `http://127.0.0.1:8551` (authrpc, JWT), gRPC `127.0.0.1:4000`, REST gateway `127.0.0.1:3500`, p2p tcp `:13000` / udp `:12000`, metrics `172.18.0.1:8080`
- `/etc/systemd/system/qrysm-validator.service` — `After=qrysm-beacon.service`, connects to local beacon at `127.0.0.1:4000` / `127.0.0.1:3500`, reads wallet from `data/validator/wallet`, password from `etc/validator-password`, exposes metrics `172.18.0.1:8081`
- Two bootstrap nodes hardcoded in the beacon unit (extracted from `qrysm/config/params/mainnet_config.go:40-41`)
- `/etc/systemd/system/node_exporter.service` — Prometheus node exporter on `172.18.0.1:9100`

Metrics bind to the monitoring docker bridge gateway `172.18.0.1` so Prometheus (on the `monitoring_monitoring` docker network) can scrape without public exposure.

## Prometheus wiring

`/opt/quantapool/monitoring/prometheus/prometheus.yml` has `172.18.0.1:{6060,8080,8081,9100}` in place of the `VALIDATOR_HOST` placeholder. After editing the bind-mounted file, `docker restart quantapool-prometheus` is required (sed inode-swap defeats HUP reload).

Current target state (all up):
- `gqrl`, `beacon-chain`, `validator`, `contract-exporter`, `prometheus`, `alertmanager`, `node-exporter`

### Alert tuning

- `BeaconChainLowPeers` filter changed to `state="Connected"` (was matching the always-zero `state="Connecting"` bucket → constant fire).
- `NetworkInterfaceDown` excludes the unplugged secondary NIC `enp1s0f1` on this host.
- `GqrlLowPeers` threshold lowered to 1 for the small testnet peer pool.
- `HighCPUUsage` raised to 95% / 30m so initial-sync workloads don't page.
- See `monitoring/prometheus/rules/{system,validator}-alerts.yml` for rule definitions.

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

## Validator key flow (executed 2026-04-14)

1. **Generate** keystore + deposit_data on the server (testnet, blast radius limited):
   ```bash
   /opt/quantapool/node/bin/staking-deposit-cli new-seed \
     --num-validators=1 \
     --chain-name=testnet \
     --execution-address=<v2.2-pool-address> \
     --folder=/opt/quantapool/node/keys/validator_keys \
     --keystore-password-file=/opt/quantapool/node/etc/validator-password
   ```
   Mnemonic + extended seed are echoed once; capture both into `etc/validator-mnemonic.txt` immediately. Per-validator password file must be created (`openssl rand -hex 32`) before this command.

2. **Verify** the generated `deposit_data-*.json` against the live pool:
   ```bash
   node scripts/verify-deposit-data.js /path/to/deposit_data.json
   ```
   Asserts pubkey 2592 B, signature 4627 B, withdrawal-credentials prefix `0x00`, embedded address matches `pool.depositPoolV2`, amount = 40 000 QRL, fork_version = `0x20000089`. Refuses if any check fails.

3. **Broadcast** the deposit:
   ```bash
   node scripts/fund-validator-real.js /path/to/deposit_data.json
   ```
   Tops up the pool buffer to 40 000 QRL if needed, then calls `pool.fundValidator(pubkey, creds, sig, root)`. This is the real beacon path.

4. **Import** into the validator wallet:
   ```bash
   /opt/quantapool/node/bin/validator accounts import \
     --wallet-dir=/opt/quantapool/node/data/validator/wallet \
     --keys-dir=/opt/quantapool/node/keys/validator_keys \
     --wallet-password-file=/opt/quantapool/node/etc/validator-password \
     --account-password-file=/opt/quantapool/node/etc/validator-password \
     --accept-terms-of-use
   ```

5. **Start** the validator: `systemctl enable --now qrysm-validator.service`. The validator polls the beacon until `validator_statuses{}` ≠ 0, transitioning `UNKNOWN → DEPOSITED → PENDING → ACTIVE` over the next several epochs (~hours on testnet, depending on activation queue depth).

## Still pending

- Confirm validator transitions to `ACTIVE` and starts signing attestations.
- Verify pool's `_syncRewards()` picks up the rewards routed back to the withdrawal address once the validator starts producing.
- Decide whether to back up `data/validator/validator.db` (slashing-protection DB) before any future validator restart on a new host.
