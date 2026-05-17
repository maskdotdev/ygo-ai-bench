import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const DIRECT_ATTACK_FIXTURE_COUNT = 5;
const directAttackKindCounts = {
  cannotDirectAttack: 1,
  directAttackConversion: 1,
  directAttackOnly: 1,
  directAttackPermission: 1,
  directTargetLock: 1,
} satisfies Record<DirectAttackKind, number>;

type DirectAttackKind =
  | "cannotDirectAttack"
  | "directAttackConversion"
  | "directAttackOnly"
  | "directAttackPermission"
  | "directTargetLock";

describe("Lua real direct-attack restore coverage", () => {
  it("requires representative direct-attack fixtures to assert clean Lua restore and replayed legal actions", () => {
    const files = realScriptDirectAttackFixtureFiles();
    expect(files).toHaveLength(DIRECT_ATTACK_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps direct-attack fixture kinds explicit", () => {
    expect(countDirectAttackKinds(realScriptDirectAttackFixtureFiles())).toEqual(directAttackKindCounts);
  });
});

function realScriptDirectAttackFixtureFiles(): Array<{
  file: string;
  kind: DirectAttackKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-dragonic-halberd-cannot-direct.test.ts",
      kind: "cannotDirectAttack",
      required: [
        "code: 73",
        "hasDirectAttack(actions, halberd.uid)).toBe(false)",
        "hasDirectAttack(actions, ordinary.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-inaba-white-rabbit-direct-only.test.ts",
      kind: "directAttackOnly",
      required: [
        "directAttack: true",
        "targetUid: defender!.uid",
        "battleDamage).toEqual({ 0: 0, 1: 700 })",
      ],
    },
    {
      file: "test/lua-real-script-jinzo-seven-direct-attack.test.ts",
      kind: "directAttackPermission",
      required: [
        "hasAttack(actions, jinzo.uid, defender.uid)).toBe(true)",
        "hasDirectAttack(actions, jinzo.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-reverse-buster-direct-target-lock.test.ts",
      kind: "directTargetLock",
      required: [
        "code === 332",
        'luaValueDescriptor: "value-card:not-facedown"',
        "hasDirectAttack(actions, buster.uid)).toBe(false)",
        "hasAttack(actions, buster.uid, faceUpTarget.uid)).toBe(false)",
        "hasAttack(actions, buster.uid, faceDownTarget.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-toon-defense-change-attack-target.test.ts",
      kind: "directAttackConversion",
      required: [
        'eventName: "attackDeclared"',
        "currentAttack?.targetUid).toBeUndefined()",
        "battleDamage).toMatchObject({ 1: 1800 })",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DirectAttackKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countDirectAttackKinds(fixtures: Array<{ kind: DirectAttackKind }>): Record<DirectAttackKind, number> {
  return fixtures.reduce<Record<DirectAttackKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      cannotDirectAttack: 0,
      directAttackConversion: 0,
      directAttackOnly: 0,
      directAttackPermission: 0,
      directTargetLock: 0,
    },
  );
}
