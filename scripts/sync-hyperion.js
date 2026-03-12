const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const solidityContractsDir = path.join(repoRoot, 'contracts', 'solidity');
const solidityTestsDir = path.join(repoRoot, 'test');
const hyperionContractsDir = path.join(repoRoot, 'hyperion', 'contracts');
const hyperionTestsDir = path.join(repoRoot, 'hyperion', 'test');
const mirroredTestFiles = [
    'DepositPool-v2.t.sol',
    'ValidatorManager.t.sol',
    'stQRL-v2.t.sol'
];

function toHyperionSource(source, sourceFile, sourceDirLabel) {
    const pragmaUpdated = source.replace(/^pragma solidity\b/m, 'pragma hyperion');

    if (pragmaUpdated === source) {
        throw new Error(`Could not find Solidity pragma in ${sourceDirLabel}/${sourceFile}`);
    }

    const importsUpdated = pragmaUpdated
        .replace(/\.\.\/contracts\/solidity\//g, '../contracts/')
        .replace(/(import\s+[^'"]*["'][^'"]+)\.sol(["'];)/g, '$1.hyp$2');

    const banner =
        `// Generated from ../${sourceDirLabel}/${sourceFile} by scripts/sync-hyperion.js.\n` +
        '// Edit the Solidity source first, then re-run this script.\n';

    if (importsUpdated.startsWith('// SPDX-License-Identifier:')) {
        const firstNewline = importsUpdated.indexOf('\n');
        return `${importsUpdated.slice(0, firstNewline + 1)}${banner}${importsUpdated.slice(firstNewline + 1)}`;
    }

    return `${banner}${importsUpdated}`;
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
