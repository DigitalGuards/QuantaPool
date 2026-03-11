const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { syncHyperionSources } = require('./sync-hyperion');

const repoRoot = path.join(__dirname, '..');
const hyperionContractsDir = path.join(repoRoot, 'hyperion', 'contracts');
const hyperionArtifactsDir = path.join(repoRoot, 'hyperion', 'artifacts');
const compilerBinary = process.env.HYPERION_COMPILER || process.env.HYPC_BIN || 'hypc';

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

    for (const file of fs.readdirSync(hyperionArtifactsDir)) {
        fs.rmSync(path.join(hyperionArtifactsDir, file), { force: true, recursive: true });
    }
}

function compileSources(selectedSources = []) {
    syncHyperionSources();
    ensureCompilerAvailable();
    clearArtifactsDir();

    const availableSources = fs.readdirSync(hyperionContractsDir)
        .filter(file => file.endsWith('.hyp'))
        .sort();

    const sourceFiles = selectedSources.length > 0
        ? selectedSources.map(file => (file.endsWith('.hyp') ? file : `${file}.hyp`))
        : availableSources;

    const manifest = {
        compiler: compilerBinary,
        generatedAt: new Date().toISOString(),
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
                `--base-path=${hyperionContractsDir}`,
                `--allow-paths=${repoRoot},${hyperionContractsDir}`,
                `--output-dir=${hyperionArtifactsDir}`,
                '--overwrite',
                sourcePath
            ],
            { stdio: 'inherit' }
        );

        manifest.contracts.push({
            sourceFile,
            contractName,
            abiFile: `${contractName}.abi`,
            binFile: `${contractName}.bin`
        });
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
