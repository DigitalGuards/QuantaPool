import legacyPolyfills from "rollup-plugin-node-polyfills";
import type { Plugin } from "rollup";
import { isArray, isRecord, InvalidInputError } from "../src/utils/guards.ts";

function isStringArray(value: unknown): value is string[] {
  return isArray(value) && value.every((item) => typeof item === "string");
}

interface LegacySourceMap {
  mappings: string;
  version: number;
  names: string[];
  sources: (string | null)[];
}

function isNullableStringArray(value: unknown): value is (string | null)[] {
  return (
    isArray(value) &&
    value.every((item) => item === null || typeof item === "string")
  );
}

function isSourceMap(value: unknown): value is LegacySourceMap | string | null {
  if (value === null || typeof value === "string") return true;
  if (!isRecord(value)) return false;
  return (
    typeof value.mappings === "string" &&
    typeof value.version === "number" &&
    isStringArray(value.names) &&
    isNullableStringArray(value.sources) &&
    (value.file === undefined ||
      value.file === null ||
      typeof value.file === "string") &&
    (value.sourceRoot === undefined || typeof value.sourceRoot === "string") &&
    (value.sourcesContent === undefined ||
      isNullableStringArray(value.sourcesContent)) &&
    (value.x_google_ignoreList === undefined ||
      (isArray(value.x_google_ignoreList) &&
        value.x_google_ignoreList.every((item) => typeof item === "number")))
  );
}

function isTransformResult(value: unknown): value is {
  code: string;
  map?: LegacySourceMap | string | null | undefined;
} {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    (value.map === undefined || isSourceMap(value.map))
  );
}

/** Adapt the legacy hook signatures and validate their untyped results. */
export function nodePolyfills(): Plugin {
  const plugin = legacyPolyfills();
  return {
    name: plugin.name,
    resolveId(source, importer) {
      const result: unknown = plugin.resolveId(source, importer ?? "");
      if (result === null) return null;
      if (
        !isRecord(result) ||
        typeof result.id !== "string" ||
        typeof result.moduleSideEffects !== "boolean"
      )
        throw new InvalidInputError("Invalid polyfill resolution");
      return { id: result.id, moduleSideEffects: result.moduleSideEffects };
    },
    load(id) {
      return plugin.load(id);
    },
    transform(code, id) {
      // The injection hook uses Rollup's context for parsing and sourcemaps.
      const result: unknown = plugin.transform.call(this, code, id);
      if (result === null || result === undefined || typeof result === "string")
        return result;
      if (!isTransformResult(result))
        throw new InvalidInputError("Invalid polyfill transform");
      // Legacy sourcemaps contain null entries. Rollup accepts their JSON form.
      return {
        code: result.code,
        map:
          typeof result.map === "object" && result.map !== null
            ? JSON.stringify(result.map)
            : result.map,
      };
    },
  };
}
