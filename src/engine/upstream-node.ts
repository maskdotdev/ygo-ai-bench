import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeCdbRows, parseBanlistConf, upstreamBanlistPath, upstreamDatabasePath, upstreamScriptPath, type BanlistEntry, type RawCdbDataRow, type RawCdbTextRow, type UpstreamSourceConfig } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import type { LuaScriptSource } from "#lua/host.js";

export interface UpstreamNodeWorkspace extends LuaScriptSource {
  readonly config: UpstreamSourceConfig;
  scriptPath(code: string | number): string;
  scriptPaths(name: string): string[];
  databasePath(filename: string): string;
  banlistPath(filename: string): string;
  readCardScript(code: string | number): string | undefined;
  readDatabaseCards(filename: string): DuelCardData[];
  readBanlist(filename: string): BanlistEntry[];
}

export function createUpstreamNodeWorkspace(config: UpstreamSourceConfig): UpstreamNodeWorkspace {
  return {
    config,
    scriptPath(code) {
      return resolveWorkspacePath(upstreamScriptPath(config, code));
    },
    scriptPaths(name) {
      return scriptCandidatePaths(config, name);
    },
    databasePath(filename) {
      return resolveWorkspacePath(upstreamDatabasePath(config, filename));
    },
    banlistPath(filename) {
      return resolveWorkspacePath(upstreamBanlistPath(config, filename));
    },
    readScript(name) {
      for (const candidate of scriptCandidatePaths(config, name)) {
        const text = readTextIfExists(candidate);
        if (text !== undefined) return text;
      }
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
      return normalizeCdbRows(datas, texts);
    },
    readBanlist(filename) {
      const text = readTextIfExists(resolveWorkspacePath(upstreamBanlistPath(config, filename)));
      return text === undefined ? [] : parseBanlistConf(text);
    },
  };
}

function scriptCandidatePaths(config: UpstreamSourceConfig, name: string): string[] {
  const scriptRoot = resolveWorkspacePath(config.root, config.scriptPath ?? "script");
  if (path.isAbsolute(name)) return [name];
  if (name.includes("/") || name.includes("\\")) return [resolveWorkspacePath(scriptRoot, name)];
  return [
    resolveWorkspacePath(scriptRoot, "official", name),
    resolveWorkspacePath(scriptRoot, name),
  ];
}

function scriptFilenameForCode(code: string | number): string {
  return `c${String(code)}.lua`;
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
