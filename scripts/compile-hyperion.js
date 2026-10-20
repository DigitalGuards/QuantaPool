const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const hyperionContractsDir = path.join(repoRoot, 'native', 'contracts');
const hyperionArtifactsDir = path.join(repoRoot, 'build', 'native');
const toolchainConfigPath = path.join(repoRoot, 'config', 'hyperion-toolchain.json');
const toolchain = JSON.parse(fs.readFileSync(toolchainConfigPath, 'utf8'));
const compilerBinary =
    process.env.HYPERION_COMPILER ||
    process.env.HYPC_BIN ||
    path.join(repoRoot, 'findings/native-network-20260915/sources/hyperion/build/hypc/hypc');
const optimizerRuns = '1';
const maxRuntimeCodeBytes = 24_576;

function sha256File(filePath) {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function ensureCompilerAvailable() {
    const result = spawnSync(compilerBinary, ['--version'], { encoding: 'utf8' });

    if (result.error && result.error.code === 'ENOENT') {
        throw new Error(
            `Hyperion compiler not found: ${compilerBinary}. ` +
            'Install hypc and/or set HYPERION_COMPILER=/path/to/hypc.'
        );
    }

    if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || 'Unable to execute hypc.').trim());
    }

    const versionOutput = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    if (!versionOutput.includes(toolchain.compilerVersion)) {
        throw new Error(
            `Unreviewed Hyperion compiler version. Expected ${toolchain.compilerVersion}.`
        );
    }

    const compilerSha256 = sha256File(compilerBinary);
    if (compilerSha256 !== toolchain.compilerSha256) {
        throw new Error(
            `Unreviewed Hyperion compiler binary. Expected SHA-256 ${toolchain.compilerSha256}, ` +
                `received ${compilerSha256}.`
        );
    }

    return { versionOutput, compilerSha256 };
}

function discoverPrimaryContractName(source) {
    const matches = [
        ...source.matchAll(/^\s*(?:abstract\s+)?contract\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)
    ];

    if (matches.length === 0) {
        throw new Error('No deployable contract definition found in Hyperion source.');
    }

    return matches[matches.length - 1][1];
}

function clearArtifactsDir() {
    fs.mkdirSync(hyperionArtifactsDir, { recursive: true });
}

function compileSources(selectedSources = []) {
    const compilerIdentity = ensureCompilerAvailable();
    clearArtifactsDir();
    const fingerprintSources = () => Object.fromEntries(fs.readdirSync(hyperionContractsDir)
        .filter(file => file.endsWith('.hyp')).sort()
        .map(file => [file, sha256File(path.join(hyperionContractsDir, file))]));
    const sourceHashes = fingerprintSources();

    const availableSources = ['NativeFinalityVerifier.hyp', 'NativePortfolioVerifier.hyp',
        'NativeValidatorGate.hyp', 'NativeQrlPool.hyp'];

    const sourceFiles = selectedSources.length > 0
        ? selectedSources.map(file => (file.endsWith('.hyp') ? file : `${file}.hyp`))
        : availableSources;

    const manifest = {
        compiler: {
            version: toolchain.compilerVersion,
            sha256: compilerIdentity.compilerSha256,
            hyperionCommit: toolchain.hyperionCommit
        },
        compilerSettings: {
            optimize: true,
            optimizeRuns: Number(optimizerRuns),
            viaIR: true
        },
        generatedAt: new Date().toISOString(),
        sourceHashes,
        contracts: []
    };

    for (const sourceFile of sourceFiles) {
        if (!availableSources.includes(sourceFile)) {
            throw new Error(`Hyperion source not found: ${sourceFile}`);
        }

        const sourcePath = path.join(hyperionContractsDir, sourceFile);
        const source = fs.readFileSync(sourcePath, 'utf8');
        const contractName = discoverPrimaryContractName(source);

        console.log(`Compiling ${sourceFile} with ${compilerBinary}...`);
        execFileSync(
            compilerBinary,
            [
                '--abi',
                '--bin',
                '--bin-runtime',
                '--storage-layout',
                '--optimize',
                `--optimize-runs=${optimizerRuns}`,
                '--via-ir',
                `--base-path=${hyperionContractsDir}`,
                `--allow-paths=${repoRoot},${hyperionContractsDir}`,
                `--output-dir=${hyperionArtifactsDir}`,
                '--overwrite',
                sourcePath
            ],
            { stdio: 'inherit' }
        );

        const runtimeBinFile = `${contractName}.bin-runtime`;
        const runtimeBytecode = fs
            .readFileSync(path.join(hyperionArtifactsDir, runtimeBinFile), 'utf8')
            .trim();
        if (!/^[0-9a-f]+$/i.test(runtimeBytecode) || runtimeBytecode.length % 2 !== 0) {
            throw new Error(`${contractName} runtime bytecode must be non-empty even-length hex`);
        }
        const runtimeCodeBytes = runtimeBytecode.length / 2;
        if (runtimeCodeBytes > maxRuntimeCodeBytes) {
            throw new Error(
                `${contractName} runtime is ${runtimeCodeBytes} bytes and exceeds go-qrl's ` +
                    `${maxRuntimeCodeBytes}-byte deployment limit`
            );
        }

        manifest.contracts.push({
            sourceFile,
            contractName,
            abiFile: `${contractName}.abi`,
            binFile: `${contractName}.bin`,
            runtimeBinFile,
            runtimeCodeBytes,
            abiSha256: sha256File(path.join(hyperionArtifactsDir, `${contractName}.abi`)),
            creationSha256: sha256File(path.join(hyperionArtifactsDir, `${contractName}.bin`)),
            runtimeSha256: sha256File(path.join(hyperionArtifactsDir, runtimeBinFile))
        });
    }

    if (JSON.stringify(sourceHashes) !== JSON.stringify(fingerprintSources())) {
        throw new Error('Native contract source changed during compilation; rebuild the complete graph.');
    }

    const manifestPath = path.join(hyperionArtifactsDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Wrote ${manifestPath}`);
}

if (require.main === module) {
    try {
        compileSources(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

module.exports = { compileSources };
