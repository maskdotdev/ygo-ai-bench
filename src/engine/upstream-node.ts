import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeCdbRows, parseBanlistConf, upstreamBanlistPath, upstreamDatabasePath, upstreamScriptPath, type BanlistEntry, type RawCdbDataRow, type RawCdbTextRow, type UpstreamSourceConfig } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import type { LuaScriptSource } from "#lua/host.js";

export interface UpstreamNodeWorkspace extends LuaScriptSource {
  readonly config: UpstreamSourceConfig;
  scriptPath(code: string | number): string;
  scriptCandidates(name: string): ScriptCandidatePath[];
  scriptPaths(name: string): string[];
  scriptAlias(code: string | number): string | undefined;
  databasePath(filename: string): string;
  banlistPath(filename: string): string;
  readCardScript(code: string | number): string | undefined;
  readDatabaseCards(filename: string): DuelCardData[];
  readBanlist(filename: string): BanlistEntry[];
}

export interface ScriptCandidatePath {
  path: string;
  source: "local-override" | "upstream-official" | "upstream-root" | "upstream-pre-release" | "local-fallback";
}

export function createUpstreamNodeWorkspace(config: UpstreamSourceConfig): UpstreamNodeWorkspace {
  const scriptAliases = readLocalScriptAliases(config);
  return {
    config,
    scriptPath(code) {
      return resolveWorkspacePath(upstreamScriptPath(config, code));
    },
    scriptCandidates(name) {
      return scriptCandidatePaths(config, name);
    },
    scriptPaths(name) {
      return scriptCandidatePaths(config, name).map((candidate) => candidate.path);
    },
    scriptAlias(code) {
      return scriptAliases.get(String(code));
    },
    databasePath(filename) {
      return resolveWorkspacePath(upstreamDatabasePath(config, filename));
    },
    banlistPath(filename) {
      return resolveWorkspacePath(upstreamBanlistPath(config, filename));
    },
    readScript(name) {
      for (const candidate of scriptCandidatePaths(config, name)) {
        const text = readTextIfExists(candidate.path);
        if (text !== undefined) return text;
      }
      const alias = scriptAliases.get(scriptCodeFromFilename(name) ?? "");
      if (alias) return `Duel.LoadCardScriptAlias(${alias})\n`;
      return undefined;
    },
    readCardScript(code) {
      return this.readScript(scriptFilenameForCode(code));
    },
    readDatabaseCards(filename) {
      const databasePath = resolveWorkspacePath(upstreamDatabasePath(config, filename));
      if (!fs.existsSync(databasePath)) return [];
      const datas = readSqliteJson<RawCdbDataRow>(databasePath, "select id, alias, setcode, type, atk, def, level, race, attribute from datas");
      const texts = readSqliteJson<RawCdbTextRow>(databasePath, "select id, name from texts");
      return mergeCardData(normalizeCdbRows(datas, texts), readSupplementalCards(config));
    },
    readBanlist(filename) {
      const text = readTextIfExists(resolveWorkspacePath(upstreamBanlistPath(config, filename)));
      return text === undefined ? [] : parseBanlistConf(text);
    },
  };
}

function readSupplementalCards(config: UpstreamSourceConfig): DuelCardData[] {
  const rowsPath = resolveWorkspacePath(config.localScriptPath ?? "local-card-scripts", "card-data.json");
  const text = readTextIfExists(rowsPath);
  if (text === undefined) return [];
  const parsed = JSON.parse(text) as { datas?: unknown; texts?: unknown };
  if (!Array.isArray(parsed.datas) || !Array.isArray(parsed.texts)) {
    throw new Error(`Supplemental card data ${rowsPath} must contain datas and texts arrays`);
  }
  return normalizeCdbRows(parsed.datas as RawCdbDataRow[], parsed.texts as RawCdbTextRow[]);
}

function mergeCardData(primary: DuelCardData[], supplemental: DuelCardData[]): DuelCardData[] {
  if (!supplemental.length) return primary;
  const byCode = new Map(primary.map((card) => [card.code, card]));
  for (const card of supplemental) byCode.set(card.code, card);
  return [...byCode.values()];
}

function readLocalScriptAliases(config: UpstreamSourceConfig): ReadonlyMap<string, string> {
  const aliasesPath = resolveWorkspacePath(config.localScriptPath ?? "local-card-scripts", "script-aliases.json");
  const text = readTextIfExists(aliasesPath);
  if (text === undefined) return new Map();
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Local script aliases ${aliasesPath} must be a JSON object`);
  return new Map(Object.entries(parsed).map(([code, alias]) => {
    if (!/^\d+$/.test(code) || typeof alias !== "string" || !/^\d+$/.test(alias)) {
      throw new Error(`Local script aliases ${aliasesPath} must map passcode strings to passcode strings`);
    }
    return [code, alias];
  }));
}

function scriptCandidatePaths(config: UpstreamSourceConfig, name: string): ScriptCandidatePath[] {
  const scriptRoot = resolveWorkspacePath(config.root, config.scriptPath ?? "script");
  const localScriptRoot = resolveWorkspacePath(config.localScriptPath ?? "local-card-scripts");
  if (path.isAbsolute(name)) return [{ path: name, source: "upstream-root" }];
  if (name.includes("/") || name.includes("\\")) {
    return [
      { path: resolveWorkspacePath(localScriptRoot, "overrides", name), source: "local-override" },
      { path: resolveWorkspacePath(scriptRoot, name), source: "upstream-root" },
      { path: resolveWorkspacePath(localScriptRoot, "fallbacks", name), source: "local-fallback" },
    ];
  }
  return [
    { path: resolveWorkspacePath(localScriptRoot, "overrides", "official", name), source: "local-override" },
    { path: resolveWorkspacePath(localScriptRoot, "overrides", name), source: "local-override" },
    { path: resolveWorkspacePath(scriptRoot, "official", name), source: "upstream-official" },
    { path: resolveWorkspacePath(scriptRoot, name), source: "upstream-root" },
    { path: resolveWorkspacePath(scriptRoot, "pre-release", name), source: "upstream-pre-release" },
    { path: resolveWorkspacePath(localScriptRoot, "fallbacks", "official", name), source: "local-fallback" },
    { path: resolveWorkspacePath(localScriptRoot, "fallbacks", name), source: "local-fallback" },
  ];
}

function scriptFilenameForCode(code: string | number): string {
  return `c${String(code)}.lua`;
}

function scriptCodeFromFilename(name: string): string | undefined {
  return /^c(\d+)\.lua$/.exec(path.basename(name))?.[1];
}

function readTextIfExists(filePath: string): string | undefined {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : undefined;
}

function readSqliteJson<Row>(databasePath: string, query: string): Row[] {
  try {
    const output = execFileSync("sqlite3", ["-readonly", "-json", databasePath, query], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return output.trim() ? JSON.parse(output) as Row[] : [];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read CDB ${databasePath}: ${detail}`);
  }
}

function resolveWorkspacePath(...parts: string[]): string {
  return path.resolve(...parts);
}
