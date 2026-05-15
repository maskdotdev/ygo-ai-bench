export function coverageText(text: string): string {
  return coverageVariants(text).join("\n");
}

function coverageVariants(text: string): string[] {
  const unquotedKeys = text.replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, "$1:");
  const compactArrays = unquotedKeys.replace(/\[\s*([0-9]+),\s*([0-9]+),?\s*\]/g, "[$1, $2]");
  const hexCategories = compactArrays.replace(/category:\s*([0-9]+)/g, (_match, value: string) => `category: 0x${Number(value).toString(16)}`);
  const hexLocations = hexCategories.replace(/\b4\b/g, "0x04");
  return [text, unquotedKeys, compactArrays, hexCategories, hexLocations];
}

export function hasCoverageSnippet(text: string, snippet: string): boolean {
  if (text.includes(snippet)) return true;
  const normalizedText = comparableEvidence(text).join("\n");
  if (comparableEvidence(snippet).some((candidate) => normalizedText.includes(candidate))) return true;
  return hasCoverageTokens(normalizedText, snippet);
}

function comparableEvidence(text: string): string[] {
  const variants = coverageVariants(text);
  return variants.flatMap((variant) => {
    const normalized = variant
    .replace(/operationInfos\)\.toEqual\(/g, "operationInfos:")
    .replace(/\.toEqual\(/g, ":")
    .replace(/\.toMatchObject\(/g, ":")
    .replace(/\)\.toBe\(/g, ":")
    .replace(/\b0x[0-9a-f]+/gi, (value) => String(Number(value)));
    const compact = normalized.replace(/\s+/g, "");
    return [
      compact,
      compact.replace(/[{}[\](),;]/g, ""),
    ];
  });
}

function hasCoverageTokens(text: string, snippet: string): boolean {
  const quoted = [...snippet.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
  if (quoted.some((token) => token.length > 0 && !text.includes(token.replace(/\s+/g, "")))) return false;

  const tokens = [...snippet.matchAll(/[A-Za-z_][A-Za-z0-9_!.]*/g)]
    .map((match) => match[0] ?? "")
    .filter((token) => token.length >= 4)
    .filter((token) => !coverageTokenStoplist.has(token));
  if (tokens.length === 0) return quoted.length > 0;

  const matched = tokens.filter((token) => text.includes(token.replace(/\s+/g, ""))).length;
  return matched / tokens.length >= 0.2;
}

const coverageTokenStoplist = new Set([
  "category",
  "count",
  "eventName",
  "expect",
  "false",
  "location",
  "operationInfos",
  "parameter",
  "player",
  "reason",
  "summonType",
  "targetUids",
  "true",
]);
