import fs from "node:fs";
const artifact = new URL(
  "../../build/native/NativeQrlPool.abi",
  import.meta.url,
);
const abi = JSON.parse(fs.readFileSync(artifact, "utf8"));
fs.writeFileSync(
  new URL("../src/abi/NativeQrlPool.ts", import.meta.url),
  "// Generated from native/contracts/NativeQrlPool.hyp using the pinned Hyperion compiler.\n" +
    `export const NativeQrlPoolABI = ${JSON.stringify(abi, null, 2)} as const;\n`,
);
