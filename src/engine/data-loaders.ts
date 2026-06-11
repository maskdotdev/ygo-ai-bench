import type { DuelCardData, DuelCardKind } from "#duel/types.js";

export interface UpstreamSourceConfig {
  root: string;
  coreUrl: string;
  scriptsUrl: string;
  databaseUrl: string;
  lflistUrl: string;
  scriptPath?: string;
  databasePath?: string;
  lflistPath?: string;
  localScriptPath?: string;
}

export interface RawCdbDataRow {
  id: number | string;
  alias?: number | string;
  setcode?: number | string;
  type?: number | string;
  atk?: number | string;
  def?: number | string;
  level?: number | string;
  race?: number | string;
  attribute?: number | string;
}

export interface RawCdbTextRow {
  id: number | string;
  name?: string;
  desc?: string;
  str1?: string;
  str2?: string;
  str3?: string;
  str4?: string;
  str5?: string;
  str6?: string;
  str7?: string;
  str8?: string;
  str9?: string;
  str10?: string;
  str11?: string;
  str12?: string;
  str13?: string;
  str14?: string;
  str15?: string;
  str16?: string;
}

export interface BanlistEntry {
  code: string;
  limit: 0 | 1 | 2 | 3;
}

export const defaultUpstreamSourceConfig: Omit<UpstreamSourceConfig, "root"> = {
  coreUrl: "https://github.com/edo9300/ygopro-core",
  scriptsUrl: "https://github.com/ProjectIgnis/CardScripts",
  databaseUrl: "https://github.com/ProjectIgnis/BabelCDB",
  lflistUrl: "https://github.com/ProjectIgnis/LFLists",
  scriptPath: "script",
  databasePath: "cdb",
  lflistPath: ".",
  localScriptPath: "local-card-scripts",
};

export function createUpstreamSourceConfig(root: string): UpstreamSourceConfig {
  return {
    root,
    ...defaultUpstreamSourceConfig,
  };
}

export function scriptFilenameForCard(code: string | number): string {
  return `c${String(code)}.lua`;
}

export function upstreamScriptPath(config: UpstreamSourceConfig, code: string | number): string {
  return joinPath(config.root, config.scriptPath ?? "script", scriptFilenameForCard(code));
}

export function upstreamDatabasePath(config: UpstreamSourceConfig, filename: string): string {
  return joinPath(config.root, config.databasePath ?? "cdb", filename);
}

export function upstreamBanlistPath(config: UpstreamSourceConfig, filename: string): string {
  return joinPath(config.root, config.lflistPath ?? ".", filename);
}

export function normalizeCdbRows(datas: RawCdbDataRow[], texts: RawCdbTextRow[]): DuelCardData[] {
  const textById = new Map(texts.map((row) => [String(row.id), row]));
  return datas.map((row) => {
    const code = String(row.id);
    const typeFlags = toNumber(row.type);
    const text = textById.get(code);
    const card: DuelCardData = {
      code,
      name: text?.name ?? `Card ${code}`,
      kind: inferKind(typeFlags),
      setcodes: parseSetcodes(row.setcode),
    };
    const description = cleanOptionalText(text?.desc);
    if (description !== undefined) card.description = description;
    const effectTexts = cdbEffectTexts(text);
    if (effectTexts !== undefined) card.effectTexts = effectTexts;
    if (row.alias !== undefined && String(row.alias) !== "0") card.alias = String(row.alias);
    if (typeFlags !== undefined) card.typeFlags = typeFlags;
    const level = toNumber(row.level);
    const attack = toNumber(row.atk);
    const defense = toNumber(row.def);
    const race = toNumber(row.race);
    const attribute = toNumber(row.attribute);
    if (level !== undefined) {
      card.level = level & 0xff;
      card.rightScale = (level >> 16) & 0xff;
      card.leftScale = (level >> 24) & 0xff;
    }
    if (attack !== undefined) card.attack = attack;
    if (defense !== undefined) {
      if (((typeFlags ?? 0) & 0x4000000) !== 0) card.linkMarkers = defense;
      else card.defense = defense;
    }
    if (race !== undefined) card.race = race;
    if (attribute !== undefined) card.attribute = attribute;
    return card;
  });
}

const cdbStringFields = [
  "str1", "str2", "str3", "str4",
  "str5", "str6", "str7", "str8",
  "str9", "str10", "str11", "str12",
  "str13", "str14", "str15", "str16",
] as const;

function cdbEffectTexts(text: RawCdbTextRow | undefined): string[] | undefined {
  if (text === undefined) return undefined;
  const values = cdbStringFields.map((field) => cleanOptionalText(text[field]) ?? "");
  return values.some((value) => value.length > 0) ? values : undefined;
}

function cleanOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createCardReader(cards: Iterable<DuelCardData>) {
  const byCode = new Map(Array.from(cards, (card) => [card.code, card]));
  return (code: string): DuelCardData | undefined => byCode.get(String(code));
}

export function parseBanlistConf(input: string): BanlistEntry[] {
  const entries: BanlistEntry[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("!") || line.startsWith("#") || line.startsWith("--")) continue;
    const [code, limit] = line.split(/\s+/);
    const parsed = Number(limit);
    if (!code || !Number.isInteger(parsed) || parsed < 0 || parsed > 3) continue;
    entries.push({ code, limit: parsed as 0 | 1 | 2 | 3 });
  }
  return entries;
}

function inferKind(typeFlags: number | undefined): DuelCardKind {
  if (typeFlags === undefined) return "monster";
  if ((typeFlags & 0x2) !== 0) return "spell";
  if ((typeFlags & 0x4) !== 0) return "trap";
  if ((typeFlags & 0x800000) !== 0 || (typeFlags & 0x2000000) !== 0 || (typeFlags & 0x4000000) !== 0 || (typeFlags & 0x8000000) !== 0) return "extra";
  return "monster";
}

function parseSetcodes(value: number | string | undefined): number[] {
  if (value === undefined) return [];
  const numeric = toNumber(value);
  if (numeric === undefined || numeric === 0) return [];
  const setcodes: number[] = [];
  let remaining = numeric;
  while (remaining > 0) {
    setcodes.push(remaining & 0xffff);
    remaining = Math.floor(remaining / 0x10000);
  }
  return setcodes.filter((setcode) => setcode !== 0);
}

function toNumber(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function joinPath(...parts: string[]): string {
  const joined = parts
    .flatMap((part) => part.split("/"))
    .filter((part) => part && part !== ".")
    .join("/");
  return parts[0]?.startsWith("/") ? `/${joined}` : joined;
}
