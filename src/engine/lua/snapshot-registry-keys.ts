export function luaRegistryCardCodes(registryKeys: Set<string>, chainLimitRegistryKeys: string[] = []): Set<string> {
  const codes = new Set<string>();
  for (const key of registryKeys) { const [, code] = key.split(":"); if (code && /^\d+$/.test(code)) codes.add(code); }
  for (const key of chainLimitRegistryKeys) { const [, code] = key.split(":"); if (code && /^\d+$/.test(code) && luaChainLimitRequiresScript(key)) codes.add(code); }
  return codes;
}

function luaChainLimitRequiresScript(key: string): boolean {
  const parts = key.split(":");
  const predicate = parts[4] === "known" ? parts.slice(5).join(":") : undefined;
  return predicate === undefined || /^c\d+\.[A-Za-z_]\w*$/.test(predicate);
}
