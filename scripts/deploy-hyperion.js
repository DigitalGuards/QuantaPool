const fs = require('fs');
const path = require('path');
const { createHash, randomBytes } = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Web3 } = require('@theqrl/web3');
const { loadDeployer } = require('./lib/loadDeployer');

const repoRoot = path.join(__dirname, '..');
const configPath =
    process.env.HYPERION_CONFIG || path.join(repoRoot, 'config', 'testnet-hyperion.json');
const manifestPath = path.join(repoRoot, 'build', 'hyperion', 'manifest.json');
const DEPLOYMENT_CONTRACTS = ['stQRLv2', 'DepositPoolV2', 'ValidatorManager'];
const DEPLOYMENT_TRANSACTION_COUNT = 8;
const MAX_ACCOUNT_NONCE = (1n << 64n) - 1n;

function loadJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hashContents(contents) {
    return createHash('sha256').update(contents).digest('hex');
}

function readRegularFileSnapshot(filePath) {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const fileDescriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    try {
        const fileStat = fs.fstatSync(fileDescriptor);
        if (!fileStat.isFile()) {
            throw new Error(`Expected a regular file: ${filePath}`);
        }

        const contents = fs.readFileSync(fileDescriptor, 'utf8');
        return {
            contents,
            digest: hashContents(contents),
            mode: fileStat.mode & 0o777
        };
    } finally {
        fs.closeSync(fileDescriptor);
    }
}

function loadDeployConfigSnapshot(filePath = configPath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Config not found: ${filePath}`);
    }

    const snapshot = readRegularFileSnapshot(filePath);
    return {
        config: JSON.parse(snapshot.contents),
        digest: snapshot.digest
    };
}

function requireDeploymentConfirmation(
    config,
    connectedChainId,
    deployerAddress,
    deploymentFingerprint
) {
    if (config.chainId === undefined || config.chainId === null) {
        throw new Error(`Config ${configPath} must declare chainId`);
    }

    const expectedChainId = BigInt(config.chainId);
    const actualChainId = BigInt(connectedChainId);
    if (actualChainId !== expectedChainId) {
        throw new Error(`Wrong chain: expected ${expectedChainId}, received ${actualChainId}`);
    }

    if (!/^[a-f0-9]{64}$/.test(deploymentFingerprint)) {
        throw new Error('Deployment fingerprint must be a lowercase SHA-256 digest');
    }

    const expectedConfirmation = `DEPLOY:${expectedChainId}:${deployerAddress}:${deploymentFingerprint}`;
    if (process.env.HYPERION_DEPLOY_CONFIRM !== expectedConfirmation) {
        throw new Error(
            `Refusing deployment. Set HYPERION_DEPLOY_CONFIRM=${expectedConfirmation} ` +
                'after verifying the provider, chain, and deployer.'
        );
    }

    const existingContracts = Object.values(config.contracts || {}).filter(Boolean);
    if (existingContracts.length > 0 && process.env.HYPERION_REPLACE_EXISTING !== 'true') {
        throw new Error(
            'Config already contains contract addresses. Set ' +
                'HYPERION_REPLACE_EXISTING=true only when intentionally replacing that deployment.'
        );
    }
}

function redactProviderForLogs(provider) {
    try {
        const parsed = new URL(provider);
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
            return '[configured provider]';
        }

        // RPC providers commonly embed project tokens in the URL path. The
        // origin is enough to identify the target network during deployment;
        // keep credentials, path, query, and fragment out of terminal/CI logs.
        return `${parsed.protocol}//${parsed.host}/`;
    } catch {
        return '[configured provider]';
    }
}

function sanitizeErrorForLogs(error) {
    const message = error instanceof Error ? error.message : String(error);
    const withoutAnsi = message.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '');
    const withoutRawUrls = withoutAnsi.replace(/\b(?:https?|wss?):\/\/[^\s"'`<>]+/gi, (provider) =>
        redactProviderForLogs(provider)
    );

    return (
        withoutRawUrls
            .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'Deployment failed'
    );
}

function getRequiredConfirmations(config) {
    const confirmations = Number(config.txConfirmations);
    if (!Number.isSafeInteger(confirmations) || confirmations < 1) {
        throw new Error(`Config ${configPath} must declare a positive integer txConfirmations`);
    }

    return confirmations;
}

function normalizeAccountNonce(value) {
    let nonce;
    try {
        nonce = BigInt(value);
    } catch {
        throw new Error(`Invalid account nonce: ${value}`);
    }

    if (nonce < 0n || nonce > MAX_ACCOUNT_NONCE) {
        throw new Error(`Account nonce must be between 0 and ${MAX_ACCOUNT_NONCE}`);
    }

    return nonce;
}

function encodeRlpNonce(value) {
    const nonce = normalizeAccountNonce(value);
    if (nonce === 0n) return Buffer.from([0x80]);

    let nonceHex = nonce.toString(16);
    if (nonceHex.length % 2 !== 0) nonceHex = `0${nonceHex}`;
    const nonceBytes = Buffer.from(nonceHex, 'hex');
    if (nonceBytes.length === 1 && nonceBytes[0] < 0x80) return nonceBytes;

    return Buffer.concat([Buffer.from([0x80 + nonceBytes.length]), nonceBytes]);
}

function predictContractAddress(deployerAddress, nonce) {
    const addressMatch = String(deployerAddress).match(/^(?:Q|0x)([a-f0-9]{40})$/i);
    if (!addressMatch) {
        throw new Error(`Invalid QRL deployer address: ${deployerAddress}`);
    }

    const encodedAddress = Buffer.concat([
        Buffer.from([0x94]),
        Buffer.from(addressMatch[1], 'hex')
    ]);
    const encodedNonce = encodeRlpNonce(nonce);
    const payload = Buffer.concat([encodedAddress, encodedNonce]);
    const encodedCreateInput = Buffer.concat([Buffer.from([0xc0 + payload.length]), payload]);
    const digest = Web3.utils.keccak256(`0x${encodedCreateInput.toString('hex')}`);

    return `Q${digest.slice(-40)}`;
}

function createDeploymentPlan(deployerAddress, startingNonceValue) {
    const startingNonce = normalizeAccountNonce(startingNonceValue);
    if (startingNonce + BigInt(DEPLOYMENT_TRANSACTION_COUNT - 1) > MAX_ACCOUNT_NONCE) {
        throw new Error('Account nonce is too high for the complete deployment sequence');
    }

    return {
        startingNonce: startingNonce.toString(),
        transactionCount: DEPLOYMENT_TRANSACTION_COUNT,
        contracts: DEPLOYMENT_CONTRACTS.map((contractName, index) => {
            const nonce = startingNonce + BigInt(index);
            return {
                contractName,
                nonce: nonce.toString(),
                predictedAddress: predictContractAddress(deployerAddress, nonce)
            };
        })
    };
}

function plannedNonce(deploymentPlan, offset) {
    if (
        !deploymentPlan ||
        deploymentPlan.transactionCount !== DEPLOYMENT_TRANSACTION_COUNT ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset >= DEPLOYMENT_TRANSACTION_COUNT
    ) {
        throw new Error('Invalid deployment transaction plan');
    }

    return (normalizeAccountNonce(deploymentPlan.startingNonce) + BigInt(offset)).toString();
}

async function requireExpectedPendingNonce(web3, deployerAddress, expectedNonce) {
    const expected = normalizeAccountNonce(expectedNonce);
    const observed = normalizeAccountNonce(
        await web3.qrl.getTransactionCount(deployerAddress, 'pending')
    );
    if (observed !== expected) {
        throw new Error(
            `Deployer pending nonce changed: expected ${expected}, received ${observed}. ` +
                'Restart the deployment and verify the new fingerprint.'
        );
    }

    return observed;
}

function getDeploymentLockPath(chainId, deployerAddress) {
    const normalizedChainId = BigInt(chainId);
    const normalizedAddress = String(deployerAddress).toLowerCase();
    if (normalizedChainId < 0n || !/^q[a-f0-9]{40}$/.test(normalizedAddress)) {
        throw new Error('Cannot derive a deployment lock for an invalid chain or deployer');
    }

    return path.join(repoRoot, `.deploy-hyperion-${normalizedChainId}-${normalizedAddress}.lock`);
}

function acquireDeploymentLock(lockPath, metadata = {}) {
    let fileDescriptor;
    let identity;
    try {
        fileDescriptor = fs.openSync(
            lockPath,
            fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
            0o600
        );
    } catch (error) {
        if (error && error.code === 'EEXIST') {
            throw new Error(
                `Deployment lock already exists: ${lockPath}. ` +
                    'Another deploy may be running; remove a stale lock only after verifying ' +
                    'no deploy process is active.'
            );
        }
        throw error;
    }

    try {
        identity = fs.fstatSync(fileDescriptor, { bigint: true });
        fs.writeFileSync(
            fileDescriptor,
            `${JSON.stringify({
                ...metadata,
                pid: process.pid,
                startedAt: new Date().toISOString()
            })}\n`
        );
        fs.fsyncSync(fileDescriptor);
        return {
            fileDescriptor,
            path: lockPath,
            device: identity.dev,
            inode: identity.ino
        };
    } catch (error) {
        try {
            const currentIdentity = fs.lstatSync(lockPath, { bigint: true });
            if (
                currentIdentity.dev === identity.dev &&
                currentIdentity.ino === identity.ino &&
                currentIdentity.isFile()
            ) {
                fs.unlinkSync(lockPath);
            }
        } catch {
            // Keep the original lock acquisition error.
        }
        fs.closeSync(fileDescriptor);
        throw error;
    }
}

function releaseDeploymentLock(lock) {
    if (!lock || lock.fileDescriptor === undefined) return;

    try {
        const currentIdentity = fs.lstatSync(lock.path, { bigint: true });
        if (
            currentIdentity.dev !== lock.device ||
            currentIdentity.ino !== lock.inode ||
            !currentIdentity.isFile()
        ) {
            throw new Error(`Deployment lock identity changed; refusing to remove ${lock.path}`);
        }
        fs.unlinkSync(lock.path);
    } finally {
        fs.closeSync(lock.fileDescriptor);
        lock.fileDescriptor = undefined;
    }
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForTransactionConfirmations(
    web3,
    receipt,
    requiredConfirmations,
    { pollIntervalMs = 15_000, wait = sleep } = {}
) {
    if (!Number.isSafeInteger(requiredConfirmations) || requiredConfirmations < 1) {
        throw new Error('requiredConfirmations must be a positive integer');
    }
    if (
        !receipt ||
        !receipt.transactionHash ||
        receipt.blockNumber === undefined ||
        receipt.blockNumber === null ||
        !receipt.blockHash
    ) {
        throw new Error('Cannot confirm a transaction without hash, block number, and block hash');
    }

    const minedBlock = BigInt(receipt.blockNumber);
    const targetBlock = minedBlock + BigInt(requiredConfirmations - 1);
    console.log(
        `Waiting for ${requiredConfirmations} confirmation(s) on ${receipt.transactionHash} ` +
            `(target block ${targetBlock})...`
    );

    while (BigInt(await web3.qrl.getBlockNumber()) < targetBlock) {
        await wait(pollIntervalMs);
    }

    const canonicalReceipt = await web3.qrl.getTransactionReceipt(receipt.transactionHash);
    if (!canonicalReceipt) {
        throw new Error(
            `Transaction ${receipt.transactionHash} is absent after the confirmation wait`
        );
    }

    const originalBlockHash = String(receipt.blockHash).toLowerCase();
    const canonicalBlockHash = String(canonicalReceipt.blockHash || '').toLowerCase();
    if (
        canonicalBlockHash !== originalBlockHash ||
        BigInt(canonicalReceipt.blockNumber) !== minedBlock
    ) {
        throw new Error(
            `Transaction ${receipt.transactionHash} changed canonical block during ` +
                'confirmation wait'
        );
    }

    console.log(`Confirmed through block ${targetBlock}.`);
    return canonicalReceipt;
}

function loadManifest(filePath = manifestPath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Manifest not found: ${filePath}. Run "npm run compile:hyperion" first.`);
    }

    return loadJson(filePath);
}

function loadArtifact(contractName, manifest, sourceManifestPath = manifestPath) {
    const entry = manifest.contracts.find((item) => item.contractName === contractName);

    if (!entry) {
        throw new Error(`Contract ${contractName} not found in ${sourceManifestPath}`);
    }

    const artifactsDir = path.dirname(sourceManifestPath);
    const abiPath = path.join(artifactsDir, entry.abiFile);
    const binPath = path.join(artifactsDir, entry.binFile);

    if (!fs.existsSync(abiPath) || !fs.existsSync(binPath)) {
        throw new Error(`Missing Hyperion artifact files for ${contractName}`);
    }

    return {
        contractName,
        abi: loadJson(abiPath),
        bytecode: `0x${fs.readFileSync(binPath, 'utf8').trim()}`
    };
}

function loadDeploymentArtifacts(sourceManifestPath = manifestPath) {
    const manifest = loadManifest(sourceManifestPath);
    if (!Array.isArray(manifest.contracts)) {
        throw new Error(`Invalid Hyperion manifest: ${sourceManifestPath}`);
    }

    return DEPLOYMENT_CONTRACTS.map((contractName) =>
        loadArtifact(contractName, manifest, sourceManifestPath)
    );
}

function getDeploymentFingerprint(config, deployerAddress, artifacts, deploymentPlan) {
    if (!Array.isArray(artifacts) || artifacts.length !== DEPLOYMENT_CONTRACTS.length) {
        throw new Error('Deployment fingerprint requires the complete artifact snapshot');
    }
    if (!deploymentPlan || !Array.isArray(deploymentPlan.contracts)) {
        throw new Error('Deployment fingerprint requires a nonce-bound deployment plan');
    }

    const existingContracts = Object.entries(config.contracts || {}).sort(([left], [right]) =>
        left.localeCompare(right)
    );
    const intent = {
        provider: config.provider,
        chainId: String(BigInt(config.chainId)),
        txConfirmations: getRequiredConfirmations(config),
        deployer: String(deployerAddress).toLowerCase(),
        existingContracts,
        deploymentPlan: {
            startingNonce: normalizeAccountNonce(deploymentPlan.startingNonce).toString(),
            transactionCount: deploymentPlan.transactionCount,
            contracts: deploymentPlan.contracts.map((contract) => ({
                contractName: contract.contractName,
                nonce: normalizeAccountNonce(contract.nonce).toString(),
                predictedAddress: String(contract.predictedAddress).toLowerCase()
            }))
        },
        artifacts: artifacts.map((artifact) => ({
            contractName: artifact.contractName,
            abi: artifact.abi,
            bytecode: artifact.bytecode
        }))
    };

    return createHash('sha256').update(JSON.stringify(intent)).digest('hex');
}

function addressesMatch(left, right) {
    return (
        typeof left === 'string' &&
        typeof right === 'string' &&
        left.toLowerCase() === right.toLowerCase()
    );
}

function isTrue(value) {
    return value === true || value === 'true';
}

async function verifyDeploymentState(stQRL, depositPool, validatorManager, deployerAddress) {
    const [
        configuredStQRL,
        configuredTokenPool,
        configuredManagerPool,
        poolPaused,
        tokenPaused,
        tokenOwner,
        poolOwner,
        managerOwner
    ] = await Promise.all([
        depositPool.methods.stQRL().call(),
        stQRL.methods.depositPool().call(),
        validatorManager.methods.depositPool().call(),
        depositPool.methods.paused().call(),
        stQRL.methods.paused().call(),
        stQRL.methods.owner().call(),
        depositPool.methods.owner().call(),
        validatorManager.methods.owner().call()
    ]);

    if (!addressesMatch(configuredStQRL, stQRL.options.address)) {
        throw new Error('Post-deployment verification failed: DepositPoolV2 stQRL link');
    }
    if (!addressesMatch(configuredTokenPool, depositPool.options.address)) {
        throw new Error('Post-deployment verification failed: stQRLv2 DepositPool link');
    }
    if (!addressesMatch(configuredManagerPool, depositPool.options.address)) {
        throw new Error('Post-deployment verification failed: ValidatorManager DepositPool link');
    }
    if (!isTrue(poolPaused) || !isTrue(tokenPaused)) {
        throw new Error('Post-deployment verification failed: contracts must remain paused');
    }
    for (const [label, observedOwner] of [
        ['stQRLv2', tokenOwner],
        ['DepositPoolV2', poolOwner],
        ['ValidatorManager', managerOwner]
    ]) {
        if (!addressesMatch(observedOwner, deployerAddress)) {
            throw new Error(`Post-deployment verification failed: ${label} owner`);
        }
    }
}

function assertFileDigest(filePath, expectedDigest) {
    if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
        throw new Error('Expected config digest must be a lowercase SHA-256 digest');
    }

    const observedDigest = readRegularFileSnapshot(filePath).digest;
    if (observedDigest !== expectedDigest) {
        throw new Error(
            `Config changed on disk during deployment: ${filePath}. ` +
                'Refusing to overwrite a newer configuration.'
        );
    }
}

function fsyncDirectory(directoryPath) {
    const directoryDescriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    try {
        fs.fsyncSync(directoryDescriptor);
    } finally {
        fs.closeSync(directoryDescriptor);
    }
}

function writeJsonAtomic(filePath, value, expectedDigest, { randomBytesFn = randomBytes } = {}) {
    const originalSnapshot = readRegularFileSnapshot(filePath);
    const randomSuffix = randomBytesFn(16).toString('hex');
    if (!/^[a-f0-9]{32}$/.test(randomSuffix)) {
        throw new Error('Atomic config writer received invalid random bytes');
    }

    const temporaryPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.tmp-${process.pid}-${randomSuffix}`
    );
    let temporaryDescriptor;
    let temporaryIdentity;
    let renamed = false;
    try {
        temporaryDescriptor = fs.openSync(
            temporaryPath,
            fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
            originalSnapshot.mode
        );
        temporaryIdentity = fs.fstatSync(temporaryDescriptor, { bigint: true });
        fs.fchmodSync(temporaryDescriptor, originalSnapshot.mode);
        fs.writeFileSync(temporaryDescriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        fs.fsyncSync(temporaryDescriptor);

        assertFileDigest(filePath, expectedDigest);

        const currentTemporaryIdentity = fs.lstatSync(temporaryPath, { bigint: true });
        if (
            currentTemporaryIdentity.dev !== temporaryIdentity.dev ||
            currentTemporaryIdentity.ino !== temporaryIdentity.ino ||
            !currentTemporaryIdentity.isFile()
        ) {
            throw new Error('Atomic config temporary file identity changed before rename');
        }

        fs.renameSync(temporaryPath, filePath);
        renamed = true;
        fsyncDirectory(path.dirname(filePath));
    } finally {
        if (temporaryDescriptor !== undefined) fs.closeSync(temporaryDescriptor);
        if (!renamed) {
            try {
                const currentTemporaryIdentity = fs.lstatSync(temporaryPath, { bigint: true });
                if (
                    temporaryIdentity &&
                    currentTemporaryIdentity.dev === temporaryIdentity.dev &&
                    currentTemporaryIdentity.ino === temporaryIdentity.ino &&
                    currentTemporaryIdentity.isFile()
                ) {
                    fs.unlinkSync(temporaryPath);
                }
            } catch (error) {
                if (!error || error.code !== 'ENOENT') throw error;
            }
        }
    }
}

function getAccount(web3) {
    if (!process.env.TESTNET_SEED) {
        throw new Error('TESTNET_SEED environment variable is required');
    }

    const mnemonic = process.env.TESTNET_SEED;
    const account = loadDeployer(web3, mnemonic);
    return account;
}

async function deployContract(web3, account, artifact, planEntry, constructorArgs = []) {
    if (!artifact || artifact.contractName !== planEntry.contractName) {
        throw new Error('Artifact snapshot does not match the deployment plan');
    }

    const nonce = normalizeAccountNonce(planEntry.nonce).toString();
    console.log(`\nDeploying ${artifact.contractName} at nonce ${nonce}...`);

    const contract = new web3.qrl.Contract(artifact.abi);
    const deployTx = contract.deploy({
        data: artifact.bytecode,
        arguments: constructorArgs
    });

    const gas = await deployTx.estimateGas({ from: account.address, nonce });
    console.log(`  Gas estimate: ${gas}`);

    const deployed = await deployTx.send({
        from: account.address,
        gas: Math.floor(Number(gas) * 1.2),
        nonce
    });

    if (!addressesMatch(deployed.options.address, planEntry.predictedAddress)) {
        throw new Error(
            `${artifact.contractName} deployed at ${deployed.options.address}, ` +
                `but the confirmed address was ${planEntry.predictedAddress}`
        );
    }

    console.log(`  Address: ${deployed.options.address}`);
    return deployed;
}

async function sendConfiguredTx(method, account, label, nonceValue) {
    const nonce = normalizeAccountNonce(nonceValue).toString();
    const gas = await method.estimateGas({ from: account.address, nonce });
    const tx = await method.send({
        from: account.address,
        gas: Math.floor(Number(gas) * 1.2),
        nonce
    });

    console.log(`${label}: ${tx.transactionHash || 'submitted'}`);
    return tx;
}

function indexDeploymentItems(items, label) {
    const indexed = new Map();
    for (const item of items || []) {
        if (!DEPLOYMENT_CONTRACTS.includes(item.contractName) || indexed.has(item.contractName)) {
            throw new Error(`Invalid ${label} entry: ${item.contractName}`);
        }
        indexed.set(item.contractName, item);
    }
    if (indexed.size !== DEPLOYMENT_CONTRACTS.length) {
        throw new Error(`Incomplete ${label} snapshot`);
    }

    return indexed;
}

async function deployAndConfigure(web3, account, artifacts, deploymentPlan) {
    const artifactsByName = indexDeploymentItems(artifacts, 'artifact');
    const plansByName = indexDeploymentItems(deploymentPlan.contracts, 'deployment plan');

    const stQRL = await deployContract(
        web3,
        account,
        artifactsByName.get('stQRLv2'),
        plansByName.get('stQRLv2')
    );
    const depositPool = await deployContract(
        web3,
        account,
        artifactsByName.get('DepositPoolV2'),
        plansByName.get('DepositPoolV2')
    );
    const validatorManager = await deployContract(
        web3,
        account,
        artifactsByName.get('ValidatorManager'),
        plansByName.get('ValidatorManager')
    );

    console.log('\nApplying safe launch state...');

    // Pause both user-facing contracts before wiring makes deposits possible.
    // Verification and seed-liquidity checks must complete before a separate
    // operator action unpauses the deployment.
    await sendConfiguredTx(
        depositPool.methods.pause(),
        account,
        '  DepositPoolV2.pause',
        plannedNonce(deploymentPlan, 3)
    );
    await sendConfiguredTx(
        stQRL.methods.pause(),
        account,
        '  stQRLv2.pause',
        plannedNonce(deploymentPlan, 4)
    );

    console.log('\nConfiguring contract links...');

    await sendConfiguredTx(
        depositPool.methods.setStQRL(stQRL.options.address),
        account,
        '  DepositPoolV2.setStQRL',
        plannedNonce(deploymentPlan, 5)
    );

    await sendConfiguredTx(
        stQRL.methods.setDepositPool(depositPool.options.address),
        account,
        '  stQRLv2.setDepositPool',
        plannedNonce(deploymentPlan, 6)
    );

    const finalWiringReceipt = await sendConfiguredTx(
        validatorManager.methods.setDepositPool(depositPool.options.address),
        account,
        '  ValidatorManager.setDepositPool',
        plannedNonce(deploymentPlan, 7)
    );

    return { stQRL, depositPool, validatorManager, finalWiringReceipt };
}

async function finalizeDeployment({
    web3,
    finalWiringReceipt,
    requiredConfirmations,
    stQRL,
    depositPool,
    validatorManager,
    deployerAddress,
    config,
    destinationConfigPath,
    expectedConfigDigest,
    writeConfig = writeJsonAtomic
}) {
    // The deployer transactions use explicit consecutive nonces. Waiting for
    // the final wiring transaction also confirms every preceding deployment,
    // pause, and one-shot wiring transaction to the configured depth.
    await waitForTransactionConfirmations(web3, finalWiringReceipt, requiredConfirmations);

    await verifyDeploymentState(stQRL, depositPool, validatorManager, deployerAddress);

    const updatedConfig = {
        ...config,
        contracts: {
            stQRLV2: stQRL.options.address,
            depositPoolV2: depositPool.options.address,
            validatorManager: validatorManager.options.address
        }
    };
    writeConfig(destinationConfigPath, updatedConfig, expectedConfigDigest);

    return updatedConfig;
}

async function main() {
    const configSnapshot = loadDeployConfigSnapshot();
    const config = configSnapshot.config;

    console.log('='.repeat(60));
    console.log('QuantaPool Hyperion v2 Deployment');
    console.log('='.repeat(60));
    console.log(`Config: ${configPath}`);
    console.log(`Provider endpoint: ${redactProviderForLogs(config.provider)}`);

    const web3 = new Web3(config.provider);
    const chainId = await web3.qrl.getChainId();
    console.log(`Connected to chain ID: ${chainId}`);

    const account = getAccount(web3);
    console.log(`Deployer: ${account.address}`);

    const deploymentLock = acquireDeploymentLock(getDeploymentLockPath(chainId, account.address), {
        chainId: String(BigInt(chainId)),
        deployer: account.address
    });
    let deploymentError;
    try {
        const artifacts = loadDeploymentArtifacts();
        const startingNonce = normalizeAccountNonce(
            await web3.qrl.getTransactionCount(account.address, 'pending')
        );
        const deploymentPlan = createDeploymentPlan(account.address, startingNonce);
        const deploymentFingerprint = getDeploymentFingerprint(
            config,
            account.address,
            artifacts,
            deploymentPlan
        );

        console.log(`Starting pending nonce: ${deploymentPlan.startingNonce}`);
        for (const plannedContract of deploymentPlan.contracts) {
            console.log(
                `Predicted ${plannedContract.contractName}: ` +
                    `${plannedContract.predictedAddress} (nonce ${plannedContract.nonce})`
            );
        }
        console.log(`Deployment fingerprint: ${deploymentFingerprint}`);
        requireDeploymentConfirmation(config, chainId, account.address, deploymentFingerprint);
        const requiredConfirmations = getRequiredConfirmations(config);
        console.log(`Required confirmations: ${requiredConfirmations}`);

        // Fail before the first transaction if the reviewed config or nonce
        // changed while the operator was preparing the confirmation value.
        assertFileDigest(configPath, configSnapshot.digest);
        await requireExpectedPendingNonce(web3, account.address, startingNonce);

        const balance = await web3.qrl.getBalance(account.address);
        console.log(`Balance: ${web3.utils.fromPlanck(balance, 'quanta')} QRL`);

        const deployed = await deployAndConfigure(web3, account, artifacts, deploymentPlan);

        await finalizeDeployment({
            web3,
            ...deployed,
            requiredConfirmations,
            deployerAddress: account.address,
            config,
            destinationConfigPath: configPath,
            expectedConfigDigest: configSnapshot.digest
        });
        console.log('Post-deployment links, ownership, and paused state verified.');

        console.log('\nDeployment complete.');
        console.log(`stQRLV2: ${deployed.stQRL.options.address}`);
        console.log(`DepositPoolV2: ${deployed.depositPool.options.address}`);
        console.log(`ValidatorManager: ${deployed.validatorManager.options.address}`);
        console.log(`Updated config: ${configPath}`);
    } catch (error) {
        deploymentError = error;
        throw error;
    } finally {
        try {
            releaseDeploymentLock(deploymentLock);
        } catch (lockError) {
            if (!deploymentError) throw lockError;
            console.error(`Warning: ${sanitizeErrorForLogs(lockError)}`);
        }
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(sanitizeErrorForLogs(error));
        process.exit(1);
    });
}

module.exports = {
    acquireDeploymentLock,
    assertFileDigest,
    createDeploymentPlan,
    deployAndConfigure,
    finalizeDeployment,
    getRequiredConfirmations,
    getDeploymentFingerprint,
    loadDeployConfigSnapshot,
    loadDeploymentArtifacts,
    predictContractAddress,
    redactProviderForLogs,
    releaseDeploymentLock,
    requireExpectedPendingNonce,
    requireDeploymentConfirmation,
    sanitizeErrorForLogs,
    verifyDeploymentState,
    waitForTransactionConfirmations,
    writeJsonAtomic
};
