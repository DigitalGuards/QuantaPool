import assert from "node:assert/strict";
import test from "node:test";
import { isQrlAddress, requireQrlAccount } from "./qrlAddress.ts";

const ACCOUNT = `Q${"12".repeat(20)}`;
const SECOND_ACCOUNT = `Q${"34".repeat(20)}`;

test("current QRL accounts require uppercase Q plus exactly 40 hex characters", () => {
  assert.equal(isQrlAddress(ACCOUNT), true);
  assert.equal(isQrlAddress(`Z${ACCOUNT.slice(1)}`), false);
  assert.equal(isQrlAddress(`${ACCOUNT}00`), false);
  assert.equal(isQrlAddress("Qshort"), false);
});

test("wallet responses require exactly one valid account", () => {
  assert.equal(requireQrlAccount([ACCOUNT]), ACCOUNT);
  assert.throws(() => requireQrlAccount([]), /invalid QRL account/);
  assert.throws(() => requireQrlAccount([ACCOUNT, SECOND_ACCOUNT]), /invalid QRL account/);
  assert.throws(() => requireQrlAccount([`Z${ACCOUNT.slice(1)}`]), /invalid QRL account/);
});
