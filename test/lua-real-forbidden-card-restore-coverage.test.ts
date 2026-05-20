import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const forbiddenCardFixtureCount = 2;
const forbiddenCardKindCounts = {
  announcedSameCodeForbidden: 1,
  announcedSameOriginalCodeStaticForbidden: 1,
} satisfies Record<ForbiddenCardKind, number>;

type ForbiddenCardKind = "announcedSameCodeForbidden" | "announcedSameOriginalCodeStaticForbidden";

describe("Lua real forbidden-card restore coverage", () => {
  it("keeps forbidden-card restore fixture inventory explicit", () => {
    expect(realScriptForbiddenCardFixtures()).toHaveLength(forbiddenCardFixtureCount);
    expect(countForbiddenCardKinds(realScriptForbiddenCardFixtures())).toEqual(forbiddenCardKindCounts);
  });

  it("requires forbidden-card fixtures to prove clean restore and blocked legal actions", () => {
    const missing = realScriptForbiddenCardFixtures()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptForbiddenCardFixtures(): Array<{
  file: string;
  kind: ForbiddenCardKind;
  requiredSnippets: string[];
}> {
  return [
    {
      file: "test/lua-real-script-prohibition-announce-forbidden-card.test.ts",
      kind: "announcedSameOriginalCodeStaticForbidden",
      requiredSnippets: [
        'const prohibitionCode = "43711255"',
        "restores its S/T-zone same-original-code forbidden-card lock",
        "Duel.AnnounceCard(tp)",
        "e2:SetCode(EFFECT_FORBIDDEN)",
        "e2:SetLabelObject(e1)",
        "c:IsOriginalCodeRule(e:GetLabelObject():GetLabel())",
        'luaTargetDescriptor: "target:same-code-label-object-label"',
        "targetRange: [0x7f, 0x7f]",
        "action.type === \"normalSummon\" && action.uid === p0Declared.uid)).toBe(false)",
        "action.type === \"setMonster\" && action.uid === p0Declared.uid)).toBe(false)",
        "action.type === \"activateEffect\" && action.uid === p0Declared.uid)).toBe(false)",
        "action.type === \"normalSummon\" && action.uid === p1Declared.uid)).toBe(false)",
        "action.type === \"setMonster\" && action.uid === p1Declared.uid)).toBe(false)",
        "action.type === \"activateEffect\" && action.uid === p1Declared.uid)).toBe(false)",
        "actionHasUid(action, p0Allowed.uid))).toBe(true)",
        "actionHasUid(action, p1Allowed.uid))).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-psi-blocker-announce-forbidden-card.test.ts",
      kind: "announcedSameCodeForbidden",
      requiredSnippets: [
        'const psiBlockerCode = "29417188"',
        "restores its announced same-code forbidden-card lock for both players",
        "Duel.AnnounceCard(tp)",
        "e1:SetCode(EFFECT_FORBIDDEN)",
        "return c:IsCode(e:GetLabel())",
        'luaTargetDescriptor: "target:same-code-label"',
        "targetRange: [0x7f, 0x7f]",
        "action.type === \"normalSummon\" && action.uid === p0Declared.uid)).toBe(false)",
        "action.type === \"setMonster\" && action.uid === p0Declared.uid)).toBe(false)",
        "action.type === \"activateEffect\" && action.uid === p0Declared.uid)).toBe(false)",
        "action.type === \"normalSummon\" && action.uid === p1Declared.uid)).toBe(false)",
        "action.type === \"setMonster\" && action.uid === p1Declared.uid)).toBe(false)",
        "action.type === \"activateEffect\" && action.uid === p1Declared.uid)).toBe(false)",
        "action.uid === p0Allowed.uid)).toBe(true)",
        "action.uid === p1Allowed.uid)).toBe(true)",
      ],
    },
  ];
}

function countForbiddenCardKinds(fixtures: Array<{ kind: ForbiddenCardKind }>): Record<ForbiddenCardKind, number> {
  return fixtures.reduce<Record<ForbiddenCardKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      announcedSameCodeForbidden: 0,
      announcedSameOriginalCodeStaticForbidden: 0,
    },
  );
}
