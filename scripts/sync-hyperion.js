const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const solidityContractsDir = path.join(repoRoot, 'contracts', 'solidity');
const solidityTestsDir = path.join(repoRoot, 'contracts', 'test');
const hyperionContractsDir = path.join(repoRoot, 'contracts', 'hyperion');
const hyperionTestsDir = path.join(repoRoot, 'contracts', 'test', 'hyperion');
const mirroredTestFiles = [
    'DepositPool-v2.t.sol',
    'ValidatorManager.t.sol',
    'stQRL-v2.t.sol'
];

function toHyperionSource(source, sourceFile, sourceDirLabel) {
    const pragmaUpdated = source.replace(
        /^pragma solidity\s+[^;]+;/m,
        'pragma hyperion >=0.0;'
    );

    if (pragmaUpdated === source) {
        throw new Error(`Could not find Solidity pragma in ${sourceDirLabel}/${sourceFile}`);
    }

    // Rewrite imports:
    //   Production .sol at contracts/solidity/*.sol generates to
    //   contracts/hyperion/*.hyp - same-directory imports need no path rewrite.
    //   Test .sol at contracts/test/*.sol imports ../solidity/Foo.sol;
    //   its .hyp mirror at contracts/test/hyperion/*.t.hyp needs ../../hyperion/Foo.hyp.
    const importsUpdated = pragmaUpdated
        .replace(/\.\.\/solidity\//g, '../../hyperion/')
        .replace(/(import\s+[^'"]*["'][^'"]+)\.sol(["'];)/g, '$1.hyp$2');

    // Translate Solidity unit denominations to Hyperion equivalents.
    // 1 ether (Solidity) == 1 quanta (Hyperion) == 10^18 planck.
    const denominationsUpdated = importsUpdated
        .replace(/(\b\d[\d_]*(?:\.\d+)?\s+)ether\b/g, '$1quanta')
        .replace(/(\b\d[\d_]*(?:\.\d+)?\s+)gwei\b/g, '$1shor')
        .replace(/(\b\d[\d_]*(?:\.\d+)?\s+)wei\b/g, '$1planck');

    // Translate Solidity 0x-prefixed 40-hex address literals to Hyperion
    // Q-prefixed form. Only matches exactly 40 hex chars to avoid touching
    // bytes32 / bytes4 / numeric literals.
    const addressesUpdated = denominationsUpdated.replace(
        /\b0x([0-9a-fA-F]{40})\b/g,
        'Q$1'
    );

    const banner =
        `// Generated from ../${sourceDirLabel}/${sourceFile} by scripts/sync-hyperion.js.\n` +
        '// Edit the Solidity source first, then re-run this script.\n';

    if (addressesUpdated.startsWith('// SPDX-License-Identifier:')) {
        const firstNewline = addressesUpdated.indexOf('\n');
        return `${addressesUpdated.slice(0, firstNewline + 1)}${banner}${addressesUpdated.slice(firstNewline + 1)}`;
    }

    return `${banner}${addressesUpdated}`;
}

function clearGeneratedDir(dir) {
    fs.mkdirSync(dir, { recursive: true });

    for (const file of fs.readdirSync(dir)) {
        if (file.endsWith('.hyp')) {
            fs.rmSync(path.join(dir, file), { force: true });
        }
    }
}

function syncDirectory(sourceDir, targetDir, sourceFiles, sourceDirLabel) {
    const syncedFiles = [];

    for (const sourceFile of sourceFiles) {
        const sourcePath = path.join(sourceDir, sourceFile);

        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Source file not found: ${sourcePath}`);
        }

        const source = fs.readFileSync(sourcePath, 'utf8');
        const targetFile = sourceFile.replace(/\.sol$/, '.hyp');
        const targetPath = path.join(targetDir, targetFile);
        const converted = toHyperionSource(source, sourceFile, sourceDirLabel);

        fs.writeFileSync(targetPath, converted);
        syncedFiles.push(targetFile);
        console.log(`Synced ${path.relative(repoRoot, targetPath)}`);
    }

    return syncedFiles;
}

function syncHyperionSources() {
    clearGeneratedDir(hyperionContractsDir);
    clearGeneratedDir(hyperionTestsDir);

    const contractFiles = fs.readdirSync(solidityContractsDir)
        .filter(file => file.endsWith('.sol'))
        .sort();

    if (contractFiles.length === 0) {
        throw new Error('No Solidity contracts found in contracts/solidity/.');
    }

    const testFiles = mirroredTestFiles.slice().sort();

    return {
        contracts: syncDirectory(
            solidityContractsDir,
            hyperionContractsDir,
            contractFiles,
            'contracts/solidity'
        ),
        tests: syncDirectory(
            solidityTestsDir,
            hyperionTestsDir,
            testFiles,
            'test'
        )
    };
}

if (require.main === module) {
    try {
        syncHyperionSources();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

module.exports = { syncHyperionSources };
