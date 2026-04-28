export interface ParsedYdk {
  main: string[];
  extra: string[];
  side: string[];
}

export function parseYdk(text: string): ParsedYdk {
  const parsed: ParsedYdk = { main: [], extra: [], side: [] };
  let zone: keyof ParsedYdk = "main";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.toLowerCase() === "#main") {
      zone = "main";
      continue;
    }
    if (line.toLowerCase() === "#extra") {
      zone = "extra";
      continue;
    }
    if (line.toLowerCase() === "!side") {
      zone = "side";
      continue;
    }
    if (line.startsWith("#")) continue;
    if (/^\d+$/.test(line)) parsed[zone].push(line);
  }
  return parsed;
}
