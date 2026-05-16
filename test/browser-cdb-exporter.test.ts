import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const exporterPath = path.resolve("tools/export-browser-cdb-rows.mjs");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("browser CDB row exporter", () => {
  it("exports JSON-safe datas/texts rows for selected passcodes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-cdb-export-"));
    tempRoots.push(root);
    const databasePath = path.join(root, "cards.cdb");
    const outPath = path.join(root, "public", "card-data", "cdb-rows.json");
    execFileSync("sqlite3", [databasePath, [
      "create table datas(id integer, alias integer, setcode integer, type integer, atk integer, def integer, level integer, race integer, attribute integer);",
      "create table texts(id integer, name text);",
      "insert into datas values(100,0,4660,33,2500,2100,7,2,32);",
      "insert into datas values(200,0,0,2,0,0,0,0,0);",
      "insert into datas values(300,0,0,4,0,0,0,0,0);",
      "insert into texts values(100,'Exported Monster');",
      "insert into texts values(200,'Skipped Spell');",
      "insert into texts values(300,'Exported Trap');",
    ].join("")]);

    execFileSync("node", [exporterPath, "--database", databasePath, "--out", outPath, "--codes", "300,100"]);

    const payload = fs.readFileSync(outPath, "utf8");
    expect(JSON.parse(payload)).toEqual({
      datas: [
        { id: 100, alias: 0, setcode: 4660, type: 33, atk: 2500, def: 2100, level: 7, race: 2, attribute: 32 },
        { id: 300, alias: 0, setcode: 0, type: 4, atk: 0, def: 0, level: 0, race: 0, attribute: 0 },
      ],
      texts: [
        { id: 100, name: "Exported Monster" },
        { id: 300, name: "Exported Trap" },
      ],
    });
    expect(JSON.parse(fs.readFileSync(path.join(root, "public", "card-data", "manifest.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      kind: "browser-cdb-rows",
      payload: "cdb-rows.json",
      selectedCodes: ["100", "300"],
      datasRows: 2,
      textsRows: 2,
      sha256: crypto.createHash("sha256").update(payload).digest("hex"),
    });
  });
});
