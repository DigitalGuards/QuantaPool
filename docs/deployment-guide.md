# Deployment Guide

## Prerequisites

### 1. Synced Zond Node

Ensure your local node is fully synced:

```bash
# Check node status
systemctl --user status gzond.service beacon-chain.service

# View sync progress
journalctl --user -u gzond.service -f
```

### 2. Testnet QRL

Request testnet QRL from the QRL Discord `#testnet-faucet` channel.

### 3. Development Environment

```bash
# Node.js 18+
node --version

# Initialize project
npm init -y
npm install @theqrl/web3
```

## Project Structure

```
QuantaPool/
├── contracts/
│   ├── stQRL.hyp           # Hyperion source files
│   ├── DepositPool.hyp
│   ├── RewardsOracle.hyp
│   └── OperatorRegistry.hyp
├── scripts/
│   ├── deploy.js           # Main deployment script
│   ├── compile.js          # Hyperion compilation
│   └── interact.js         # Contract interaction helpers
├── config/
│   └── testnet.json        # Network configuration
└── artifacts/              # Compiled contracts (gitignored)
```

## Configuration

### config/testnet.json

```json
{
  "provider": "http://localhost:8545",
  "chainId": 32382,
  "hexseed": "0x...",
  "tx_required_confirmations": 12,
  "contracts": {
    "stQRL": "",
    "depositPool": "",
    "rewardsOracle": "",
    "operatorRegistry": ""
  }
}
```

**Important**: Never commit `hexseed` to version control. Use environment variables in production.

## Compilation

### Install Hyperion Compiler

```bash
# Download hypc (Hyperion compiler)
# Check QRL docs for latest version
wget https://github.com/theQRL/go-zond/releases/download/v1.0.0/hypc-linux-amd64
chmod +x hypc-linux-amd64
sudo mv hypc-linux-amd64 /usr/local/bin/hypc
```

### Compile Contracts

```javascript
// scripts/compile.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const contracts = ['stQRL', 'DepositPool', 'RewardsOracle', 'OperatorRegistry'];

contracts.forEach(name => {
  const source = path.join(__dirname, '..', 'contracts', `${name}.hyp`);
  const output = path.join(__dirname, '..', 'artifacts');

  execSync(`hypc --bin --abi -o ${output} ${source}`);
  console.log(`Compiled ${name}`);
});
```

## Deployment

### scripts/deploy.js

```javascript
const Web3 = require('@theqrl/web3');
const fs = require('fs');
const config = require('../config/testnet.json');

const web3 = new Web3(config.provider);

async function deploy(contractName, constructorArgs = []) {
  const abi = JSON.parse(fs.readFileSync(`./artifacts/${contractName}.abi`));
  const bytecode = fs.readFileSync(`./artifacts/${contractName}.bin`, 'utf8');

  const account = web3.zond.accounts.seedToAccount(config.hexseed);
  web3.zond.accounts.wallet.add(account);

  const contract = new web3.zond.Contract(abi);

  const deployTx = contract.deploy({
    data: '0x' + bytecode,
    arguments: constructorArgs
  });

  const gas = await deployTx.estimateGas();

  const deployed = await deployTx.send({
    from: account.address,
    gas: Math.floor(gas * 1.2) // 20% buffer
  });

  console.log(`${contractName} deployed at: ${deployed.options.address}`);
  return deployed;
}

async function main() {
  console.log('Deploying QuantaPool contracts to Zond testnet...\n');

  // Deploy in order (dependencies first)
  const stQRL = await deploy('stQRL');
  const rewardsOracle = await deploy('RewardsOracle', [stQRL.options.address]);
  const operatorRegistry = await deploy('OperatorRegistry');
  const depositPool = await deploy('DepositPool', [
    stQRL.options.address,
    rewardsOracle.options.address,
    operatorRegistry.options.address
  ]);

  // Update config with deployed addresses
  config.contracts = {
    stQRL: stQRL.options.address,
    depositPool: depositPool.options.address,
    rewardsOracle: rewardsOracle.options.address,
    operatorRegistry: operatorRegistry.options.address
  };

  fs.writeFileSync('./config/testnet.json', JSON.stringify(config, null, 2));
  console.log('\nDeployment complete! Addresses saved to config/testnet.json');
}

main().catch(console.error);
```

### Run Deployment

```bash
# Compile first
node scripts/compile.js

# Deploy to testnet
node scripts/deploy.js
```

## Verification on ZondScan

After deployment, verify contracts on [zondscan.com](https://zondscan.com):

1. Navigate to your contract address
2. Click "Verify & Publish"
3. Upload source code (Hyperion)
4. Select compiler version
5. Submit for verification

## Post-Deployment Checklist

### Immediate

- [ ] Verify all contracts on ZondScan
- [ ] Test deposit function with small amount
- [ ] Test withdrawal function
- [ ] Confirm exchange rate calculation
- [ ] Set initial operator in registry

### Configuration

- [ ] Set oracle update permissions
- [ ] Configure emergency pause address
- [ ] Set protocol fee recipient (if applicable)
- [ ] Initialize operator bond requirements

### Testing

```javascript
// scripts/interact.js - Test interactions
const Web3 = require('@theqrl/web3');
const config = require('../config/testnet.json');

const web3 = new Web3(config.provider);

async function testDeposit(amount) {
  const abi = JSON.parse(fs.readFileSync('./artifacts/DepositPool.abi'));
  const pool = new web3.zond.Contract(abi, config.contracts.depositPool);

  const account = web3.zond.accounts.seedToAccount(config.hexseed);

  const tx = await pool.methods.deposit().send({
    from: account.address,
    value: web3.utils.toWei(amount.toString(), 'ether'),
    gas: 200000
  });

  console.log('Deposit tx:', tx.transactionHash);
}

testDeposit(100); // Deposit 100 QRL
```

## Troubleshooting

### Transaction Fails

```
Error: insufficient funds
```
- Request more testnet QRL from Discord faucet

### Gas Estimation Fails

```
Error: gas required exceeds allowance
```
- Increase gas limit
- Check contract constructor arguments
- Verify Hyperion syntax compatibility

### Node Connection Issues

```
Error: connection refused
```
- Ensure gzond service is running
- Check RPC endpoint in config
- Verify firewall allows localhost:8545

## Mainnet Deployment (Future)

**Do not deploy to mainnet without:**

1. Full security audit
2. Testnet validation complete
3. Emergency procedures documented
4. Multisig admin configured
5. TVL caps implemented
6. Insurance/collateral in place
