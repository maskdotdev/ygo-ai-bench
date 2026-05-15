import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const releaseAndTributeFixtureCount = 7;
const legalActionFixtureCount = 5;

describe("Lua real release and tribute restore coverage", () => {
  it("requires release and tribute restriction fixtures to assert clean Lua registry restore", () => {
    const files = releaseAndTributeFixtureFiles();
    expect(files).toHaveLength(releaseAndTributeFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires UI-facing legal-action parity where restored release and tribute locks expose actions", () => {
    const files = legalActionFixtureFiles();
    expect(files).toHaveLength(legalActionFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions");
      });

    expect(missing).toEqual([]);
  });
});

function releaseAndTributeFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-amorphage-wrath-release-lock.test.ts",
      required: [
        "EFFECT_CANNOT_RELEASE",
        "target:not-setcode:",
        "amorphage releasable true/false/false",
        "amorphage release locked 0",
        "amorphage release allowed 1",
      ],
    },
    {
      file: "lua-real-script-apoqliphort-tribute-limit.test.ts",
      required: [
        "EFFECT_TRIBUTE_LIMIT",
        "cannot-material:target-not-setcode:170",
        "tributeSummon",
        "cannot be released",
        "normalTributes).toBe(3)",
      ],
    },
    {
      file: "lua-real-script-assault-zone-extra-deck-release-cost.test.ts",
      required: [
        "effectExtraReleaseNonsum",
        "targetRange: [locationExtra, 0]",
        "duelReason.release | duelReason.cost",
        "previousLocation: \"extraDeck\"",
        "stardustAssault",
      ],
    },
    {
      file: "lua-real-script-diabolos-tribute-limit.test.ts",
      required: [
        "EFFECT_TRIBUTE_LIMIT",
        "cannot-material:target-not-attribute:32",
        "tributeSummon",
        "cannot be released",
        "Dark Tribute Target",
      ],
    },
    {
      file: "lua-real-script-mask-of-restrict-cannot-release.test.ts",
      required: [
        "EFFECT_CANNOT_RELEASE",
        "targetRange: [1, 1]",
        "mask release predicates false/false/false",
        "mask release result 0",
      ],
    },
    {
      file: "lua-real-script-troposphere-tribute-limit.test.ts",
      required: [
        "EFFECT_TRIBUTE_LIMIT",
        "cannot-material:target-not-race:512",
        "tributeSummon",
        "cannot be released",
        "Winged Beast Tribute",
      ],
    },
    {
      file: "lua-real-script-yellow-duston-unreleasable-tribute-lock.test.ts",
      required: [
        "Yellow Duston unreleasable tribute lock",
        "code: 43",
        "code: 44",
        "tributeSummon",
        "cannot be released",
      ],
    },
  ]
    .map(({ file, required }) => ({ file: path.join("test", file), required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function legalActionFixtureFiles(): string[] {
  return [
    "lua-real-script-apoqliphort-tribute-limit.test.ts",
    "lua-real-script-assault-zone-extra-deck-release-cost.test.ts",
    "lua-real-script-diabolos-tribute-limit.test.ts",
    "lua-real-script-troposphere-tribute-limit.test.ts",
    "lua-real-script-yellow-duston-unreleasable-tribute-lock.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}
