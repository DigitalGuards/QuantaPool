import fs from "node:fs";
import { isArray, isRecord, InvalidInputError } from "../src/utils/guards.ts";
const artifact = new URL(
  "../../build/native/NativeQrlPool.abi",
  import.meta.url,
);
const abi: unknown = JSON.parse(fs.readFileSync(artifact, "utf8"));
if (
  !isArray(abi) ||
  !abi.every((entry) => isRecord(entry) && typeof entry.type === "string")
)
  throw new InvalidInputError("Invalid native pool ABI artifact");
fs.writeFileSync(
  new URL("../src/abi/NativeQrlPool.ts", import.meta.url),
  "// Generated from native/contracts/NativeQrlPool.hyp using the pinned Hyperion compiler.\n" +
    `export const NativeQrlPoolABI = ${JSON.stringify(abi, null, 2)} as const;\n`,
);
