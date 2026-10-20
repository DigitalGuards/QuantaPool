// Native QRL ABI and SSZ encoding for current certificate transactions.
const { createHash } = require('node:crypto');
const { encodeParameters } = require('@theqrl/web3-qrl-abi');
const { keccak256 } = require('@theqrl/web3-utils');
const headerType = {
    type: 'tuple',
    components: [
        { name: 'slot', type: 'uint64' },
        { name: 'proposerIndex', type: 'uint64' },
        { name: 'parentRoot', type: 'bytes32' },
        { name: 'stateRoot', type: 'bytes32' },
        { name: 'bodyRoot', type: 'bytes32' }
    ]
};
const copy = value => structuredClone(value);
const flip = value => {
    const bytes = Buffer.from(value.slice(2), 'hex');
    bytes[0] ^= 1;
    return `0x${bytes.toString('hex')}`;
};
const sha = value => createHash('sha256').update(value).digest();
const header = value => ({
    slot: value.slot, proposerIndex: value.proposer_index,
    parentRoot: value.parent_root, stateRoot: value.state_root, bodyRoot: value.body_root
});
function headerRoot(value) {
    const integer = number => {
        const out = Buffer.alloc(32);
        out.writeBigUInt64LE(BigInt(number));
        return out;
    };
    let nodes = [integer(value.slot), integer(value.proposerIndex),
        ...[value.parentRoot, value.stateRoot, value.bodyRoot].map(hex => Buffer.from(hex.slice(2), 'hex')),
        Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32)];
    while (nodes.length > 1) {
        nodes = Array.from({ length: nodes.length / 2 }, (_, i) => sha(Buffer.concat([nodes[2 * i], nodes[2 * i + 1]])));
    }
    return `0x${nodes[0].toString('hex')}`;
}
function proposalId(args) {
    return keccak256(encodeParameters([headerType, headerType, 'bytes32'], [args[0], args[1], args[3]]));
}
function votes(update) {
    const bits = Buffer.from(update.syncCommitteeBits.slice(2), 'hex');
    const committee = update.signatureCommittee;
    let signatureIndex = 0;
    const out = [];
    for (let seat = 0; seat < 128; seat++) {
        if (!(bits[Math.floor(seat / 8)] & (1 << (seat % 8)))) continue;
        out.push({ seat: String(seat), publicKeyRoot: committee.publicKeyRoots[seat],
            publicKey: committee.publicKeys[seat], signature: update.signatures[signatureIndex++],
            branch: copy(committee.seatBranches[seat]) });
    }
    if (out.length !== update.participants || signatureIndex !== update.signatures.length || out.length < 86) {
        throw new Error('Captured update does not contain a complete quorum of positional signatures');
    }
    return out;
}

module.exports = { header, headerRoot, proposalId, votes };
