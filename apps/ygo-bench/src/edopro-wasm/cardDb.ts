import { readFile } from "node:fs/promises";
import type { OcgCardData } from "./ocgTypes.js";

interface CdbRowsFile {
  datas: Array<{
    id: number;
    alias: number;
    setcode: number;
    type: number;
    atk: number;
    def: number;
    level: number;
    race: number;
    attribute: number;
  }>;
  texts: Array<{
    id: number;
    name: string;
    desc?: string;
  }>;
}

export interface CardDatabase {
  cards: Map<number, OcgCardData>;
  names: Map<number, string>;
}

export async function loadBrowserCardDatabase(path: string): Promise<CardDatabase> {
  const rows = JSON.parse(await readFile(path, "utf8")) as CdbRowsFile;
  const cards = new Map<number, OcgCardData>();
  const names = new Map<number, string>();

  for (const row of rows.datas) {
    cards.set(row.id, {
      code: row.id,
      alias: row.alias,
      setcodes: splitSetcodes(row.setcode),
      type: row.type,
      level: row.level,
      attribute: row.attribute,
      race: BigInt(row.race),
      attack: row.atk,
      defense: row.def,
      lscale: 0,
      rscale: 0,
      link_marker: 0,
    });
  }

  for (const text of rows.texts) {
    names.set(text.id, text.name);
  }

  return { cards, names };
}

function splitSetcodes(setcode: number): number[] {
  if (setcode === 0) return [];
  const setcodes: number[] = [];
  let remaining = setcode;
  while (remaining > 0) {
    const code = remaining & 0xffff;
    if (code !== 0) setcodes.push(code);
    remaining = Math.floor(remaining / 0x10000);
  }
  return setcodes;
}
