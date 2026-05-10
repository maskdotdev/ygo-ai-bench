import { luaFunctionParams, luaFunctionSourceSnippet } from "#lua/effect-descriptor-source.js";
import type { LuaHostState } from "#lua/host-types.js";

export function knownLuaEffectConditionDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const params = luaFunctionParams(snippet);
  if (params && params.length > 0) return undefined;
  const identifier = String.raw`[A-Za-z_]\w*`;
  const sourceController = new RegExp(String.raw`\breturn\s+${identifier}\s*:\s*IsControler\s*\(\s*${identifier}\s*\)\s*(?:end\b|$)`);
  return sourceController.test(snippet) ? "condition:source-controller" : undefined;
}
