import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { OcgRuntime } from "./ocgTypes.js";

export async function loadOcgRuntime(): Promise<OcgRuntime> {
  const packageEntry = await import("@n1xx1/ocgcore-wasm");
  const packageRoot = resolve("node_modules/@n1xx1/ocgcore-wasm");
  const distEntry = await import(pathToFileURL(resolve(packageRoot, "dist/index.js")).href);
  const createCore = (distEntry as { default?: unknown }).default;

  if (typeof createCore !== "function") {
    throw new Error("Unable to load createCore from @n1xx1/ocgcore-wasm/dist/index.js");
  }

  return {
    ...(packageEntry as Omit<OcgRuntime, "createCore">),
    createCore: createCore as OcgRuntime["createCore"],
  };
}
