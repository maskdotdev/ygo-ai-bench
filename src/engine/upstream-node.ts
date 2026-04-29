import fs from "node:fs";
import path from "node:path";
import { parseBanlistConf, upstreamBanlistPath, upstreamDatabasePath, upstreamScriptPath, type BanlistEntry, type UpstreamSourceConfig } from "#engine/data-loaders.js";
import type { LuaScriptSource } from "#lua/host.js";

export interface UpstreamNodeWorkspace extends LuaScriptSource {
  readonly config: UpstreamSourceConfig;
  scriptPath(code: string | number): string;
  databasePath(filename: string): string;
  banlistPath(filename: string): string;
  readCardScript(code: string | number): string | undefined;
  readBanlist(filename: string): BanlistEntry[];
}

export function createUpstreamNodeWorkspace(config: UpstreamSourceConfig): UpstreamNodeWorkspace {
  return {
    config,
    scriptPath(code) {
      return resolveWorkspacePath(upstreamScriptPath(config, code));
    },
    databasePath(filename) {
      return resolveWorkspacePath(upstreamDatabasePath(config, filename));
    },
    banlistPath(filename) {
      return resolveWorkspacePath(upstreamBanlistPath(config, filename));
    },
    readScript(name) {
      return readTextIfExists(resolveWorkspacePath(config.root, config.scriptPath ?? "script", name));
    },
    readCardScript(code) {
      return readTextIfExists(resolveWorkspacePath(upstreamScriptPath(config, code)));
    },
    readBanlist(filename) {
      const text = readTextIfExists(resolveWorkspacePath(upstreamBanlistPath(config, filename)));
      return text === undefined ? [] : parseBanlistConf(text);
    },
  };
}

function readTextIfExists(filePath: string): string | undefined {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : undefined;
}

function resolveWorkspacePath(...parts: string[]): string {
  return path.resolve(...parts);
}
