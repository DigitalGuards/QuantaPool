import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { isQrlAddress, requireQrlAccount } from "./qrlAddress.ts";

const QIP55_ACCOUNT = `Q${"12".repeat(64)}`;
const LOWER_BODY = "ab".repeat(64);
const LEGACY_ACCOUNT = `Q${"34".repeat(20)}`;
const SECOND_ACCOUNT = `Q${"56".repeat(64)}`;

function checksummedBody(lower: string): string {
  const hash = createHash("shake256", { outputLength: 64 })
    .update(lower, "ascii")
    .digest();
  let out = "";
  for (let i = 0; i < lower.length; i += 1) {
    const c = lower.charAt(i);
    if (c < "a" || c > "f") {
      out += c;
      continue;
    }
    const byte = hash[i >> 1] ?? 0;
    const nibble = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
    out += nibble >= 8 ? c.toUpperCase() : c;
  }
  return out;
}

test("only native QIP-55 accounts are accepted", () => {
  assert.equal(isQrlAddress(QIP55_ACCOUNT), true);
  assert.equal(isQrlAddress(`Q${LOWER_BODY}`), true);
  assert.equal(isQrlAddress(`Q${LOWER_BODY.toUpperCase()}`), true);
  assert.equal(isQrlAddress(LEGACY_ACCOUNT), false); // legacy is display-only
  assert.equal(isQrlAddress(`Z${QIP55_ACCOUNT.slice(1)}`), false);
  assert.equal(isQrlAddress(`${QIP55_ACCOUNT}00`), false);
  assert.equal(isQrlAddress(`Q${"12".repeat(63)}`), false);
  assert.equal(isQrlAddress("Qshort"), false);
});

test("mixed-case bodies must match the SHAKE-256 checksum", () => {
  const canonical = `Q${checksummedBody(LOWER_BODY)}`;
  assert.equal(isQrlAddress(canonical), true);
  const body = canonical.slice(1);
  const letterIndex = body.split("").findIndex((c) => /[a-fA-F]/.test(c));
  assert.ok(letterIndex >= 0);
  const original = body.charAt(letterIndex);
  const swapped =
    original === original.toLowerCase()
      ? original.toUpperCase()
      : original.toLowerCase();
  const flipped = `Q${body.slice(0, letterIndex)}${swapped}${body.slice(letterIndex + 1)}`;
  assert.equal(isQrlAddress(flipped), false);
});

test("wallet responses require exactly one valid QIP-55 account", () => {
  assert.equal(requireQrlAccount([QIP55_ACCOUNT]), QIP55_ACCOUNT);
  assert.throws(
    () => requireQrlAccount([LEGACY_ACCOUNT]),
    /invalid QRL account/,
  );
  assert.throws(() => requireQrlAccount([]), /invalid QRL account/);
  assert.throws(
    () => requireQrlAccount([QIP55_ACCOUNT, SECOND_ACCOUNT]),
    /invalid QRL account/,
  );
  assert.throws(
    () => requireQrlAccount([`Z${QIP55_ACCOUNT.slice(1)}`]),
    /invalid QRL account/,
  );
});
