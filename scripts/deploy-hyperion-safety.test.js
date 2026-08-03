const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
    acquireDeploymentLock,
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
} = require('./deploy-hyperion');

const receipt = {
    transactionHash: '0xabc',
    blockNumber: 99n,
    blockHash: '0xdef'
};

const deploymentConfig = {
    provider: 'https://rpc.example/path?token=secret',
    chainId: 1337,
    txConfirmations: 12,
    contracts: {}
};
const deploymentArtifacts = [
    { contractName: 'stQRLv2', abi: [{ name: 'paused' }], bytecode: '0x01' },
    { contractName: 'DepositPoolV2', abi: [{ name: 'deposit' }], bytecode: '0x02' },
    { contractName: 'ValidatorManager', abi: [{ name: 'owner' }], bytecode: '0x03' }
];
const deployerAddress = 'Q1111111111111111111111111111111111111111';
const deploymentPlan = createDeploymentPlan(deployerAddress, 9n);

function fingerprint(
    config = deploymentConfig,
    address = deployerAddress,
    artifacts = deploymentArtifacts,
    plan = deploymentPlan
) {
    return getDeploymentFingerprint(config, address, artifacts, plan);
}

function makeTempDirectory() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'quantapool-deploy-test-'));
}

function makeDeploymentState(overrides = {}) {
    const poolAddress = 'Q3333333333333333333333333333333333333333';
    const tokenAddress = 'Q4444444444444444444444444444444444444444';
    const method = (value) => ({ call: async () => value });
    const values = {
        configuredStQRL: tokenAddress,
        configuredTokenPool: poolAddress,
        configuredManagerPool: poolAddress,
        poolPaused: true,
        tokenPaused: 'true',
        tokenOwner: deployerAddress,
        poolOwner: deployerAddress,
        managerOwner: deployerAddress,
        ...overrides
    };

    return {
        stQRL: {
            options: { address: tokenAddress },
            methods: {
                depositPool: () => method(values.configuredTokenPool),
                paused: () => method(values.tokenPaused),
                owner: () => method(values.tokenOwner)
            }
        },
        depositPool: {
            options: { address: poolAddress },
            methods: {
                stQRL: () => method(values.configuredStQRL),
                paused: () => method(values.poolPaused),
                owner: () => method(values.poolOwner)
            }
        },
        validatorManager: {
            options: { address: 'Q5555555555555555555555555555555555555555' },
            methods: {
                depositPool: () => method(values.configuredManagerPool),
                owner: () => method(values.managerOwner)
            }
        }
    };
}

function makeCanonicalWeb3(canonicalReceipt = receipt) {
    return {
        qrl: {
            getBlockNumber: async () => 110n,
            getTransactionReceipt: async () => canonicalReceipt
        }
    };
}

test('requires an explicit positive confirmation depth', () => {
    assert.equal(getRequiredConfirmations({ txConfirmations: 12 }), 12);
    assert.throws(() => getRequiredConfirmations({}), /positive integer txConfirmations/);
    assert.throws(
        () => getRequiredConfirmations({ txConfirmations: 0 }),
        /positive integer txConfirmations/
    );
    assert.throws(
        () => getRequiredConfirmations({ txConfirmations: 1.5 }),
        /positive integer txConfirmations/
    );
});

test('predicts QRL CREATE addresses from the deployer nonce', () => {
    const upstreamVectorDeployer = 'Q970e8128ab834e8eac17ab8e3812f010678cf791';
    assert.equal(
        predictContractAddress(upstreamVectorDeployer, 0),
        'Q333c3310824b7c685133f2bedb2ca4b8b4df633d'
    );
    assert.equal(
        predictContractAddress(upstreamVectorDeployer, 1),
        'Q8bda78331c916a08481428e4b07c96d3e916d165'
    );
    assert.equal(
        predictContractAddress(upstreamVectorDeployer, 2),
        'Qc9ddedf451bc62ce88bf9292afb13df35b670699'
    );
    assert.throws(() => predictContractAddress('not-an-address', 0), /Invalid QRL deployer/);
    assert.throws(() => predictContractAddress(upstreamVectorDeployer, -1), /between 0 and/);
});

test('creates an eight-transaction plan bound to consecutive deployment addresses', () => {
    const plan = createDeploymentPlan(deployerAddress, 17n);
    assert.equal(plan.startingNonce, '17');
    assert.equal(plan.transactionCount, 8);
    assert.deepEqual(
        plan.contracts.map((contract) => contract.nonce),
        ['17', '18', '19']
    );
    assert.deepEqual(
        plan.contracts.map((contract) => contract.predictedAddress),
        [17n, 18n, 19n].map((nonce) => predictContractAddress(deployerAddress, nonce))
    );
});

test('binds deployment confirmation to every reviewed input', () => {
    const original = fingerprint();
    assert.match(original, /^[a-f0-9]{64}$/);
    assert.equal(original, fingerprint());

    const variants = [
        fingerprint({ ...deploymentConfig, provider: 'https://other-rpc.example' }),
        fingerprint({ ...deploymentConfig, chainId: 1338 }),
        fingerprint({ ...deploymentConfig, txConfirmations: 13 }),
        fingerprint({
            ...deploymentConfig,
            contracts: { depositPoolV2: 'Q2222222222222222222222222222222222222222' }
        }),
        fingerprint(deploymentConfig, 'Q2222222222222222222222222222222222222222'),
        fingerprint(deploymentConfig, deployerAddress, [
            { ...deploymentArtifacts[0], abi: [{ name: 'owner' }] },
            ...deploymentArtifacts.slice(1)
        ]),
        fingerprint(deploymentConfig, deployerAddress, [
            ...deploymentArtifacts.slice(0, 2),
            { ...deploymentArtifacts[2], bytecode: '0x04' }
        ]),
        fingerprint(
            deploymentConfig,
            deployerAddress,
            deploymentArtifacts,
            createDeploymentPlan(deployerAddress, 10n)
        ),
        fingerprint(deploymentConfig, deployerAddress, deploymentArtifacts, {
            ...deploymentPlan,
            contracts: deploymentPlan.contracts.map((contract, index) =>
                index === 0
                    ? {
                          ...contract,
                          predictedAddress: 'Q9999999999999999999999999999999999999999'
                      }
                    : contract
            )
        })
    ];

    for (const variant of variants) assert.notEqual(original, variant);
});

test('requires the exact fingerprinted confirmation and explicit replacement opt-in', () => {
    const originalConfirmation = process.env.HYPERION_DEPLOY_CONFIRM;
    const originalReplacement = process.env.HYPERION_REPLACE_EXISTING;
    try {
        const cleanFingerprint = fingerprint();
        process.env.HYPERION_DEPLOY_CONFIRM = `DEPLOY:1337:${deployerAddress}:${cleanFingerprint}`;
        delete process.env.HYPERION_REPLACE_EXISTING;
        assert.doesNotThrow(() =>
            requireDeploymentConfirmation(deploymentConfig, 1337, deployerAddress, cleanFingerprint)
        );

        process.env.HYPERION_DEPLOY_CONFIRM = 'DEPLOY:1337:wrong';
        assert.throws(
            () =>
                requireDeploymentConfirmation(
                    deploymentConfig,
                    1337,
                    deployerAddress,
                    cleanFingerprint
                ),
            /Refusing deployment/
        );

        const replacementConfig = {
            ...deploymentConfig,
            contracts: { depositPoolV2: 'Q2222222222222222222222222222222222222222' }
        };
        const replacementFingerprint = fingerprint(replacementConfig);
        process.env.HYPERION_DEPLOY_CONFIRM = `DEPLOY:1337:${deployerAddress}:${replacementFingerprint}`;
        assert.throws(
            () =>
                requireDeploymentConfirmation(
                    replacementConfig,
                    1337,
                    deployerAddress,
                    replacementFingerprint
                ),
            /already contains contract addresses/
        );
        process.env.HYPERION_REPLACE_EXISTING = 'true';
        assert.doesNotThrow(() =>
            requireDeploymentConfirmation(
                replacementConfig,
                1337,
                deployerAddress,
                replacementFingerprint
            )
        );
    } finally {
        if (originalConfirmation === undefined) delete process.env.HYPERION_DEPLOY_CONFIRM;
        else process.env.HYPERION_DEPLOY_CONFIRM = originalConfirmation;
        if (originalReplacement === undefined) delete process.env.HYPERION_REPLACE_EXISTING;
        else process.env.HYPERION_REPLACE_EXISTING = originalReplacement;
    }
});

test('checks the pending nonce and rejects drift before deployment', async () => {
    const calls = [];
    const web3 = {
        qrl: {
            getTransactionCount: async (address, blockTag) => {
                calls.push({ address, blockTag });
                return 9n;
            }
        }
    };
    assert.equal(await requireExpectedPendingNonce(web3, deployerAddress, 9), 9n);
    assert.deepEqual(calls, [{ address: deployerAddress, blockTag: 'pending' }]);

    web3.qrl.getTransactionCount = async () => 10n;
    await assert.rejects(
        requireExpectedPendingNonce(web3, deployerAddress, 9),
        /pending nonce changed/
    );
});

test('redacts provider credentials, path, query, and fragment', () => {
    const provider =
        'https://alice:password@rpc.example:8545/api/qrl-rpc/testnet?token=secret#frag';
    assert.equal(redactProviderForLogs(provider), 'https://rpc.example:8545/');
    assert.equal(redactProviderForLogs('file:///tmp/rpc'), '[configured provider]');

    const sanitized = sanitizeErrorForLogs(new Error(`RPC failed\n\u001b[31m${provider}\u001b[0m`));
    assert.equal(sanitized, 'RPC failed https://rpc.example:8545/');
    assert.doesNotMatch(sanitized, /alice|password|token|secret|frag/);
});

test('serializes deployments with an exclusive identity-checked lock', () => {
    const directory = makeTempDirectory();
    const lockPath = path.join(directory, 'deploy.lock');
    try {
        const firstLock = acquireDeploymentLock(lockPath, { chainId: '1337' });
        assert.equal(fs.statSync(lockPath).mode & 0o777, 0o600);
        assert.throws(() => acquireDeploymentLock(lockPath), /already exists/);
        releaseDeploymentLock(firstLock);
        assert.equal(fs.existsSync(lockPath), false);

        const secondLock = acquireDeploymentLock(lockPath);
        releaseDeploymentLock(secondLock);
        assert.equal(fs.existsSync(lockPath), false);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('does not remove a deployment lock path replaced by another file', () => {
    const directory = makeTempDirectory();
    const lockPath = path.join(directory, 'deploy.lock');
    try {
        const lock = acquireDeploymentLock(lockPath);
        fs.unlinkSync(lockPath);
        fs.writeFileSync(lockPath, 'replacement');
        assert.throws(() => releaseDeploymentLock(lock), /identity changed/);
        assert.equal(fs.readFileSync(lockPath, 'utf8'), 'replacement');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('loads one artifact snapshot from a selected manifest', () => {
    const directory = makeTempDirectory();
    const manifestFile = path.join(directory, 'manifest.json');
    try {
        const contracts = deploymentArtifacts.map((artifact) => ({
            contractName: artifact.contractName,
            abiFile: `${artifact.contractName}.abi`,
            binFile: `${artifact.contractName}.bin`
        }));
        fs.writeFileSync(manifestFile, JSON.stringify({ contracts }));
        for (const artifact of deploymentArtifacts) {
            fs.writeFileSync(
                path.join(directory, `${artifact.contractName}.abi`),
                JSON.stringify(artifact.abi)
            );
            fs.writeFileSync(
                path.join(directory, `${artifact.contractName}.bin`),
                artifact.bytecode.slice(2)
            );
        }

        const snapshot = loadDeploymentArtifacts(manifestFile);
        fs.writeFileSync(path.join(directory, 'stQRLv2.bin'), 'ff');
        assert.deepEqual(snapshot, deploymentArtifacts);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('writes config through a randomized exclusive temp file and preserves its mode', () => {
    const directory = makeTempDirectory();
    const filePath = path.join(directory, 'config.json');
    try {
        fs.writeFileSync(filePath, '{"before":true}\n', { mode: 0o640 });
        const snapshot = loadDeployConfigSnapshot(filePath);
        const updated = { after: true };
        writeJsonAtomic(filePath, updated, snapshot.digest, {
            randomBytesFn: (size) => Buffer.alloc(size, 0x11)
        });

        assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), updated);
        assert.equal(fs.readFileSync(filePath, 'utf8').endsWith('\n'), true);
        assert.equal(fs.statSync(filePath).mode & 0o777, 0o640);
        assert.deepEqual(fs.readdirSync(directory), ['config.json']);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('refuses to overwrite config changed after the deployment snapshot', () => {
    const directory = makeTempDirectory();
    const filePath = path.join(directory, 'config.json');
    try {
        fs.writeFileSync(filePath, '{"version":1}\n');
        const snapshot = loadDeployConfigSnapshot(filePath);
        fs.writeFileSync(filePath, '{"version":2,"operatorEdit":true}\n');

        assert.throws(
            () =>
                writeJsonAtomic(filePath, { version: 3 }, snapshot.digest, {
                    randomBytesFn: (size) => Buffer.alloc(size, 0x22)
                }),
            /Config changed on disk/
        );
        assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
            version: 2,
            operatorEdit: true
        });
        assert.deepEqual(fs.readdirSync(directory), ['config.json']);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('never follows a precreated atomic temp path', () => {
    const directory = makeTempDirectory();
    const filePath = path.join(directory, 'config.json');
    const suffix = '00'.repeat(16);
    const temporaryPath = path.join(directory, `.config.json.tmp-${process.pid}-${suffix}`);
    try {
        fs.writeFileSync(filePath, '{"version":1}\n');
        const snapshot = loadDeployConfigSnapshot(filePath);
        fs.writeFileSync(temporaryPath, 'do-not-overwrite');

        assert.throws(
            () =>
                writeJsonAtomic(filePath, { version: 2 }, snapshot.digest, {
                    randomBytesFn: (size) => Buffer.alloc(size)
                }),
            (error) => error && error.code === 'EEXIST'
        );
        assert.equal(fs.readFileSync(temporaryPath, 'utf8'), 'do-not-overwrite');
        assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { version: 1 });
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('deploys exact artifacts at explicit nonces and pauses before wiring', async () => {
    const plan = createDeploymentPlan(deployerAddress, 21n);
    const artifacts = deploymentArtifacts.map((artifact) => ({
        ...artifact,
        abi: [{ marker: artifact.contractName }]
    }));
    const planByName = new Map(plan.contracts.map((entry) => [entry.contractName, entry]));
    const sent = [];
    const seenAbis = [];
    const seenBytecode = [];

    function transactionMethod(action) {
        return {
            estimateGas: async (options) => {
                sent.push({ phase: 'estimate', action, nonce: options.nonce });
                return 100n;
            },
            send: async (options) => {
                sent.push({ phase: 'send', action, nonce: options.nonce });
                return action === 'ValidatorManager.setDepositPool'
                    ? receipt
                    : { transactionHash: `0x${action}` };
            }
        };
    }

    function deployedContract(contractName) {
        const address = planByName.get(contractName).predictedAddress;
        const methods =
            contractName === 'stQRLv2'
                ? {
                      pause: () => transactionMethod('stQRLv2.pause'),
                      setDepositPool: () => transactionMethod('stQRLv2.setDepositPool')
                  }
                : contractName === 'DepositPoolV2'
                  ? {
                        pause: () => transactionMethod('DepositPoolV2.pause'),
                        setStQRL: () => transactionMethod('DepositPoolV2.setStQRL')
                    }
                  : {
                        setDepositPool: () => transactionMethod('ValidatorManager.setDepositPool')
                    };
        return { options: { address }, methods };
    }

    class FakeContract {
        constructor(abi) {
            this.contractName = abi[0].marker;
            seenAbis.push(abi);
        }

        deploy({ data }) {
            seenBytecode.push(data);
            const contractName = this.contractName;
            return {
                estimateGas: async (options) => {
                    sent.push({
                        phase: 'estimate',
                        action: `deploy:${contractName}`,
                        nonce: options.nonce
                    });
                    return 100n;
                },
                send: async (options) => {
                    sent.push({
                        phase: 'send',
                        action: `deploy:${contractName}`,
                        nonce: options.nonce
                    });
                    return deployedContract(contractName);
                }
            };
        }
    }

    const web3 = { qrl: { Contract: FakeContract } };
    const result = await deployAndConfigure(web3, { address: deployerAddress }, artifacts, plan);

    assert.equal(seenAbis.length, artifacts.length);
    seenAbis.forEach((abi, index) => assert.equal(abi, artifacts[index].abi));
    assert.deepEqual(
        seenBytecode,
        artifacts.map((artifact) => artifact.bytecode)
    );
    assert.equal(result.finalWiringReceipt, receipt);
    assert.deepEqual(
        sent.filter((event) => event.phase === 'send'),
        [
            { phase: 'send', action: 'deploy:stQRLv2', nonce: '21' },
            { phase: 'send', action: 'deploy:DepositPoolV2', nonce: '22' },
            { phase: 'send', action: 'deploy:ValidatorManager', nonce: '23' },
            { phase: 'send', action: 'DepositPoolV2.pause', nonce: '24' },
            { phase: 'send', action: 'stQRLv2.pause', nonce: '25' },
            { phase: 'send', action: 'DepositPoolV2.setStQRL', nonce: '26' },
            { phase: 'send', action: 'stQRLv2.setDepositPool', nonce: '27' },
            { phase: 'send', action: 'ValidatorManager.setDepositPool', nonce: '28' }
        ]
    );
    for (let index = 0; index < sent.length; index += 2) {
        assert.equal(sent[index].phase, 'estimate');
        assert.equal(sent[index + 1].phase, 'send');
        assert.equal(sent[index].action, sent[index + 1].action);
        assert.equal(sent[index].nonce, sent[index + 1].nonce);
    }
});

test('stops before pause or wiring if a deployed address differs from the confirmed plan', async () => {
    const plan = createDeploymentPlan(deployerAddress, 31n);
    const sent = [];
    class WrongAddressContract {
        constructor(abi) {
            this.contractName = abi[0].marker;
        }

        deploy() {
            return {
                estimateGas: async () => 100n,
                send: async (options) => {
                    sent.push({ contractName: this.contractName, nonce: options.nonce });
                    return {
                        options: {
                            address: 'Q9999999999999999999999999999999999999999'
                        },
                        methods: {}
                    };
                }
            };
        }
    }
    const artifacts = deploymentArtifacts.map((artifact) => ({
        ...artifact,
        abi: [{ marker: artifact.contractName }]
    }));

    await assert.rejects(
        deployAndConfigure(
            { qrl: { Contract: WrongAddressContract } },
            { address: deployerAddress },
            artifacts,
            plan
        ),
        /confirmed address/
    );
    assert.deepEqual(sent, [{ contractName: 'stQRLv2', nonce: '31' }]);
});

test('verifies every wiring link, owner, and safe paused state', async (t) => {
    const valid = makeDeploymentState();
    await assert.doesNotReject(
        verifyDeploymentState(
            valid.stQRL,
            valid.depositPool,
            valid.validatorManager,
            deployerAddress
        )
    );

    const cases = [
        [
            'pool token link',
            { configuredStQRL: 'Q6666666666666666666666666666666666666666' },
            /DepositPoolV2 stQRL link/
        ],
        [
            'token pool link',
            { configuredTokenPool: 'Q6666666666666666666666666666666666666666' },
            /stQRLv2 DepositPool link/
        ],
        [
            'manager pool link',
            { configuredManagerPool: 'Q6666666666666666666666666666666666666666' },
            /ValidatorManager DepositPool link/
        ],
        ['pool pause', { poolPaused: false }, /must remain paused/],
        ['token pause', { tokenPaused: false }, /must remain paused/],
        [
            'token owner',
            { tokenOwner: 'Q6666666666666666666666666666666666666666' },
            /stQRLv2 owner/
        ],
        [
            'pool owner',
            { poolOwner: 'Q6666666666666666666666666666666666666666' },
            /DepositPoolV2 owner/
        ],
        [
            'manager owner',
            { managerOwner: 'Q6666666666666666666666666666666666666666' },
            /ValidatorManager owner/
        ]
    ];
    for (const [name, override, expectedError] of cases) {
        await t.test(name, async () => {
            const state = makeDeploymentState(override);
            await assert.rejects(
                verifyDeploymentState(
                    state.stQRL,
                    state.depositPool,
                    state.validatorManager,
                    deployerAddress
                ),
                expectedError
            );
        });
    }
});

test('waits to configured depth and verifies the canonical receipt', async () => {
    const observedHeads = [100n, 109n, 110n];
    let headReads = 0;
    let receiptReads = 0;
    const web3 = {
        qrl: {
            getBlockNumber: async () => observedHeads[headReads++],
            getTransactionReceipt: async (hash) => {
                receiptReads += 1;
                assert.equal(hash, receipt.transactionHash);
                return receipt;
            }
        }
    };

    const canonical = await waitForTransactionConfirmations(web3, receipt, 12, {
        pollIntervalMs: 0,
        wait: async () => {}
    });

    assert.equal(canonical, receipt);
    assert.equal(headReads, 3);
    assert.equal(receiptReads, 1);
});

test('rejects a receipt moved by a reorganization', async () => {
    await assert.rejects(
        waitForTransactionConfirmations(
            makeCanonicalWeb3({ ...receipt, blockNumber: 100n, blockHash: '0x123' }),
            receipt,
            12,
            { pollIntervalMs: 0, wait: async () => {} }
        ),
        /changed canonical block/
    );
});

test('rejects a transaction missing from the canonical chain', async () => {
    await assert.rejects(
        waitForTransactionConfirmations(makeCanonicalWeb3(null), receipt, 12, {
            pollIntervalMs: 0,
            wait: async () => {}
        }),
        /is absent/
    );
});

test('persists contract addresses only after finality and state verification', async () => {
    const state = makeDeploymentState();
    const writes = [];
    const updated = await finalizeDeployment({
        web3: makeCanonicalWeb3(),
        finalWiringReceipt: receipt,
        requiredConfirmations: 12,
        ...state,
        deployerAddress,
        config: deploymentConfig,
        destinationConfigPath: '/config.json',
        expectedConfigDigest: 'a'.repeat(64),
        writeConfig: (...args) => writes.push(args)
    });

    assert.deepEqual(updated.contracts, {
        stQRLV2: state.stQRL.options.address,
        depositPoolV2: state.depositPool.options.address,
        validatorManager: state.validatorManager.options.address
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], '/config.json');
    assert.equal(writes[0][2], 'a'.repeat(64));
});

test('does not write config when finality or state verification fails', async () => {
    let writes = 0;
    const writeConfig = () => {
        writes += 1;
    };
    const state = makeDeploymentState();
    const common = {
        finalWiringReceipt: receipt,
        requiredConfirmations: 12,
        ...state,
        deployerAddress,
        config: deploymentConfig,
        destinationConfigPath: '/config.json',
        expectedConfigDigest: 'a'.repeat(64),
        writeConfig
    };

    await assert.rejects(
        finalizeDeployment({ ...common, web3: makeCanonicalWeb3(null) }),
        /is absent/
    );
    assert.equal(writes, 0);

    const invalidState = makeDeploymentState({ poolPaused: false });
    await assert.rejects(
        finalizeDeployment({
            ...common,
            ...invalidState,
            web3: makeCanonicalWeb3()
        }),
        /must remain paused/
    );
    assert.equal(writes, 0);
});
