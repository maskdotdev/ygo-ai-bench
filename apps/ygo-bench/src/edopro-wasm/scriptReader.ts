import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function createScriptReader(scriptRoot: string): (name: string) => string | null {
  return (name: string) => {
    const candidates = name.match(/^c\d+\.lua$/)
      ? [join(scriptRoot, name), join(scriptRoot, "official", name)]
      : [join(scriptRoot, name)];

    for (const candidate of candidates) {
      if (existsSync(candidate)) return readFileSync(candidate, "utf8");
    }

    return null;
  };
}
