# Adding a New Validator Runbook

## Overview

This guide covers adding new validators to the QuantaPool infrastructure.

## Prerequisites

- 40,000 QRL per validator
- Access to primary validator node
- Validator key generation tools

## Procedure

### Step 1: Generate Validator Keys

```bash
cd /opt/quantapool/key-management

# Generate keys for N new validators
./generate-keys.sh <number_of_validators> [withdrawal_address]

# Example: Generate 2 validators
./generate-keys.sh 2 Z1234567890abcdef...
```

This creates:
- `validator_keys/` - Keystore files
- `deposit_data.json` - Data for beacon deposit

### Step 2: Backup New Keys

```bash
# Encrypt and backup immediately
./encrypt-keys.sh /opt/quantapool/validator-keys/batch_TIMESTAMP

# Store backup securely (USB, encrypted cloud)
```

### Step 3: Import Keys to Validator

```bash
# Stop validator temporarily (optional, for safety)
systemctl stop qrysm-validator

# Import new keys
./import-to-validator.sh /opt/quantapool/validator-keys/batch_TIMESTAMP

# Restart validator
systemctl start qrysm-validator
```

### Step 4: Make Beacon Chain Deposit

Using the deposit_data.json, submit the deposit transaction:

```javascript
// Example using @theqrl/web3
const Web3 = require('@theqrl/web3');
const web3 = new Web3('https://qrlwallet.com/api/zond-rpc/testnet');

const depositData = require('./deposit_data.json');
const BEACON_DEPOSIT_CONTRACT = '0x4242424242424242424242424242424242424242';
const STAKE_AMOUNT = web3.utils.toWei('40000', 'ether');

for (const validator of depositData) {
    await web3.eth.sendTransaction({
        to: BEACON_DEPOSIT_CONTRACT,
        value: STAKE_AMOUNT,
        data: validator.depositData,
        from: YOUR_FUNDED_ADDRESS
    });
}
```

Or use QuantaPool's DepositPool contract:
```javascript
const depositPool = new web3.eth.Contract(DEPOSIT_POOL_ABI, DEPOSIT_POOL_ADDRESS);
await depositPool.methods.deposit().send({
    from: YOUR_ADDRESS,
    value: web3.utils.toWei('40000', 'ether')
});
```

### Step 5: Wait for Activation

- Validator enters pending queue
- Activation takes ~4-6 hours after deposit
- Monitor in Grafana dashboard

### Step 6: Verify Validator is Active

```bash
# Check validator status
curl -s http://localhost:3500/eth/v1/beacon/states/head/validators?id=<pubkey> | jq

# Check in validator client
journalctl -u qrysm-validator | grep "attestation"
```

## Copying Keys to Backup Node

For failover capability, keys must be on backup node:

```bash
# Create encrypted key package
tar -czf /tmp/new-validator-keys.tar.gz \
    -C /opt/quantapool/validator-keys \
    batch_TIMESTAMP

# Encrypt
gpg --symmetric --cipher-algo AES256 /tmp/new-validator-keys.tar.gz

# Transfer to backup
scp /tmp/new-validator-keys.tar.gz.gpg root@<backup-ip>:/tmp/

# On backup: decrypt and import (but don't start validator!)
ssh root@<backup-ip>
cd /tmp
gpg --decrypt new-validator-keys.tar.gz.gpg > new-validator-keys.tar.gz
tar -xzf new-validator-keys.tar.gz -C /opt/quantapool/validator-keys/

# Import to backup wallet (keys will be ready but validator stays disabled)
/opt/quantapool/key-management/import-to-validator.sh \
    /opt/quantapool/validator-keys/batch_TIMESTAMP
```

## Verification Checklist

- [ ] Keys generated securely
- [ ] Keys backed up (encrypted)
- [ ] Keys imported to primary
- [ ] Deposit transaction confirmed
- [ ] Validator appears in pending queue
- [ ] Validator activated
- [ ] Attestations being submitted
- [ ] Keys copied to backup node
- [ ] Monitoring dashboards updated

## Troubleshooting

### Validator Not Appearing

```bash
# Check deposit was successful
# Look up transaction on zondscan.com

# Check beacon API
curl -s http://localhost:3500/eth/v1/beacon/states/head/validators?id=<pubkey>
```

### Import Failing

```bash
# Check keystore format
cat /path/to/keystore*.json | jq

# Verify password is correct
# Try importing manually
qrysm-validator accounts import \
    --wallet-dir=/var/lib/qrysm/validator/wallet \
    --keys-dir=/path/to/keys
```

### Activation Taking Too Long

- Check validator queue length
- During high demand, activation can take longer
- Monitor beacon chain explorer
