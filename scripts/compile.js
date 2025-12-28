const solc = require('solc');
const fs = require('fs');
const path = require('path');

const contractsDir = path.join(__dirname, '..', 'contracts');
const artifactsDir = path.join(__dirname, '..', 'artifacts');

// Ensure artifacts directory exists
if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
}

function compile(contractName) {
    const contractPath = path.join(contractsDir, `${contractName}.sol`);

    if (!fs.existsSync(contractPath)) {
        console.error(`Contract not found: ${contractPath}`);
        return null;
    }

    const source = fs.readFileSync(contractPath, 'utf8');

    const input = {
        language: 'Solidity',
        sources: {
            [`${contractName}.sol`]: {
                content: source
            }
        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode.object']
                }
            },
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    };

    console.log(`Compiling ${contractName}...`);
    const output = JSON.parse(solc.compile(JSON.stringify(input)));

    // Check for errors
    if (output.errors) {
        output.errors.forEach(err => {
            if (err.severity === 'error') {
                console.error(err.formattedMessage);
                return null;
            } else {
                console.warn(err.formattedMessage);
            }
        });
    }

    const contract = output.contracts[`${contractName}.sol`][contractName];

    if (!contract) {
        console.error(`Failed to compile ${contractName}`);
        return null;
    }

    const artifact = {
        contractName,
        abi: contract.abi,
        bytecode: '0x' + contract.evm.bytecode.object
    };

    // Write artifact
    const artifactPath = path.join(artifactsDir, `${contractName}.json`);
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    console.log(`Compiled ${contractName} -> ${artifactPath}`);

    return artifact;
}

// Get contract name from command line or compile all
const args = process.argv.slice(2);

if (args.length > 0) {
    // Compile specific contract
    compile(args[0]);
} else {
    // Compile all .sol files in contracts directory
    const files = fs.readdirSync(contractsDir).filter(f => f.endsWith('.sol'));

    if (files.length === 0) {
        console.log('No .sol files found in contracts/');
    } else {
        files.forEach(file => {
            const contractName = file.replace('.sol', '');
            compile(contractName);
        });
    }
}
