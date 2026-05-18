import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const upstreamScriptRoot = path.join(root, ".upstream/ignis/script/official");
const attackRetargetFixtureCount = 6;
const upstreamChangeAttackTargetFixtureCount = 6;
const attackRetargetKindCounts = {
  directAttackConversion: 1,
  selectedTargetRetarget: 1,
  selfRetarget: 1,
  summonRetarget: 3,
} satisfies Record<AttackRetargetKind, number>;
const attackRetargetSemanticVariantCounts = {
  appleMagicianGirlHandSummonRetarget: 1,
  callEarthboundSelectedTargetRetarget: 1,
  cardBlockerSelfRetarget: 1,
  chocolateMagicianGirlGraveyardSummonRetarget: 1,
  toonDefenseDirectAttackConversion: 1,
  ultimateDivineBeastDivineSummonRetarget: 1,
} satisfies Record<AttackRetargetSemanticVariant, number>;

type AttackRetargetKind = "directAttackConversion" | "selectedTargetRetarget" | "selfRetarget" | "summonRetarget";

type AttackRetargetSemanticVariant =
  | "appleMagicianGirlHandSummonRetarget"
  | "callEarthboundSelectedTargetRetarget"
  | "cardBlockerSelfRetarget"
  | "chocolateMagicianGirlGraveyardSummonRetarget"
  | "toonDefenseDirectAttackConversion"
  | "ultimateDivineBeastDivineSummonRetarget";

describe("Lua real attack retarget restore coverage", () => {
  it.skipIf(!fs.existsSync(upstreamScriptRoot))("pins upstream ChangeAttackTarget call shapes for every retarget variant", () => {
    const fixtures = upstreamChangeAttackTargetFixtures();
    expect(fixtures).toHaveLength(upstreamChangeAttackTargetFixtureCount);

    const weak = fixtures
      .filter(({ code, required }) => {
        const text = fs.readFileSync(path.join(upstreamScriptRoot, `c${code}.lua`), "utf8");
        return required.some((snippet) => !text.includes(snippet));
      })
      .map(({ code }) => code);

    expect(weak).toEqual([]);
  });

  it("requires representative attack-retarget fixtures to assert clean Lua restore and replayed target changes", () => {
    const files = realScriptAttackRetargetFixtureFiles();
    expect(files).toHaveLength(attackRetargetFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("eventCardUid")
          || !text.includes("eventCode")
          || !text.includes("currentAttack")
          || !text.includes("pendingBattle")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps attack-retarget fixture kinds explicit", () => {
    expect(countAttackRetargetKinds(realScriptAttackRetargetFixtureFiles())).toEqual(attackRetargetKindCounts);
  });

  it("keeps named attack-retarget semantic variants explicit", () => {
    expect(countAttackRetargetSemanticVariants(realScriptAttackRetargetSemanticVariants())).toEqual(attackRetargetSemanticVariantCounts);

    const weak = realScriptAttackRetargetSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function upstreamChangeAttackTargetFixtures(): Array<{ code: string; required: string[] }> {
  return [
    { code: "56132807", required: ["e1:SetCode(EVENT_BE_BATTLE_TARGET)", "Duel.ChangeAttackTarget(tc)"] },
    { code: "42256406", required: ["e4:SetCode(EVENT_BE_BATTLE_TARGET)", "Duel.ChangeAttackTarget(c)"] },
    { code: "65743242", required: ["e1:SetCode(EVENT_ATTACK_ANNOUNCE)", "Duel.ChangeAttackTarget(nil)", "Duel.ChangeAttackTarget(tc)"] },
    { code: "7198399", required: ["e2:SetCode(EVENT_BE_BATTLE_TARGET)", "Duel.ChangeAttackTarget(tc)"] },
    { code: "43509019", required: ["e2:SetCode(EVENT_ATTACK_ANNOUNCE)", "Duel.ChangeAttackTarget(nil)"] },
    { code: "32247099", required: ["e2:SetCode(EVENT_ATTACK_ANNOUNCE)", "Duel.ChangeAttackTarget(tc)"] },
  ];
}

function realScriptAttackRetargetFixtureFiles(): Array<{
  file: string;
  kind: AttackRetargetKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-apple-magician-girl-attack-retarget.test.ts",
      kind: "summonRetarget",
      required: [
        'eventName: "battleTargeted"',
        "targetUid: spellcaster.uid",
        "battleDamage).toMatchObject({ 1: 400 })",
      ],
    },
    {
      file: "test/lua-real-script-card-blocker-change-attack-target.test.ts",
      kind: "selfRetarget",
      required: [
        "effectId.endsWith(\"-1131\")",
        "targetUid: blocker!.uid",
        "battleDamage).toMatchObject({ 1: 1400 })",
      ],
    },
    {
      file: "test/lua-real-script-call-earthbound-change-attack-target.test.ts",
      kind: "selectedTargetRetarget",
      required: [
        'action.type === "activateEffect"',
        "targetUid: newTarget!.uid",
        "battleDamage).toMatchObject({ 1: 1300 })",
      ],
    },
    {
      file: "test/lua-real-script-chocolate-magician-girl-retarget.test.ts",
      kind: "summonRetarget",
      required: [
        'eventName: "battleTargeted"',
        "targetUid: spellcaster!.uid",
        "battleDamage).toMatchObject({ 1: 400 })",
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
    {
      file: "test/lua-real-script-ultimate-divine-beast-retarget.test.ts",
      kind: "summonRetarget",
      required: [
        'eventName: "attackDeclared"',
        "targetUid: divine!.uid",
        "battleWindow?.kind).not.toBe(\"replayDecision\")",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackRetargetKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countAttackRetargetKinds(fixtures: Array<{ kind: AttackRetargetKind }>): Record<AttackRetargetKind, number> {
  return fixtures.reduce<Record<AttackRetargetKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      directAttackConversion: 0,
      selectedTargetRetarget: 0,
      selfRetarget: 0,
      summonRetarget: 0,
    },
  );
}

function realScriptAttackRetargetSemanticVariants(): Array<{
  file: string;
  kind: AttackRetargetSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-apple-magician-girl-attack-retarget.test.ts",
      kind: "appleMagicianGirlHandSummonRetarget",
      required: [
        'const appleCode = "56132807"',
        "restores her hand Spellcaster summon and redirects the attack to it",
        'triggerTiming: "if"',
        'sourceUid": "p1-deck-56132807-0"',
        "targetUid: spellcaster.uid",
        "players[1].lifePoints).toBe(7600)",
      ],
    },
    {
      file: "test/lua-real-script-call-earthbound-change-attack-target.test.ts",
      kind: "callEarthboundSelectedTargetRetarget",
      required: [
        'const callCode = "65743242"',
        "restores Call of the Earthbound and changes the attack target to another legal monster",
        'const sevenToolsCode = "3819470"',
        "action.type === \"activateEffect\" && action.uid === sevenTools!.uid)).toBe(true)",
        "targetUid: newTarget!.uid",
        "battleDamage).toMatchObject({ 1: 1300 })",
      ],
    },
    {
      file: "test/lua-real-script-card-blocker-change-attack-target.test.ts",
      kind: "cardBlockerSelfRetarget",
      required: [
        'const blockerCode = "42256406"',
        "restores its field battle-target trigger and redirects to itself",
        "effectId.endsWith(\"-1131\")",
        "targetUid: blocker!.uid",
        "players[1].lifePoints).toBe(6600)",
      ],
    },
    {
      file: "test/lua-real-script-chocolate-magician-girl-retarget.test.ts",
      kind: "chocolateMagicianGirlGraveyardSummonRetarget",
      required: [
        'const chocolateCode = "7198399"',
        "restores her battle-target trigger and retargets the attack to the summoned Spellcaster",
        "triggerSourceOnly: true",
        "moveDuelCard(session.state, spellcaster!.uid, \"graveyard\", 1)",
        "targetUid: spellcaster!.uid",
        "players[1].lifePoints).toBe(7600)",
      ],
    },
    {
      file: "test/lua-real-script-toon-defense-change-attack-target.test.ts",
      kind: "toonDefenseDirectAttackConversion",
      required: [
        'const toonDefenseCode = "43509019"',
        "restores Toon Defense's attack-declaration trigger and changes the attack into a direct attack",
        "currentAttack?.targetUid).toBeUndefined()",
        "pendingBattle?.targetUid).toBeUndefined()",
        "battleDamage).toMatchObject({ 1: 1800 })",
      ],
    },
    {
      file: "test/lua-real-script-ultimate-divine-beast-retarget.test.ts",
      kind: "ultimateDivineBeastDivineSummonRetarget",
      required: [
        'const ultimateDivineBeastCode = "32247099"',
        "restores its attack-announcement trigger and retargets to the summoned DIVINE monster",
        "moveDuelCard(session.state, discard!.uid, \"hand\", 1)",
        "targetUid: divine!.uid",
        "location: \"graveyard\", controller: 1",
        "position: \"faceUpDefense\"",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackRetargetSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countAttackRetargetSemanticVariants(fixtures: Array<{ kind: AttackRetargetSemanticVariant }>): Record<AttackRetargetSemanticVariant, number> {
  return fixtures.reduce<Record<AttackRetargetSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      appleMagicianGirlHandSummonRetarget: 0,
      callEarthboundSelectedTargetRetarget: 0,
      cardBlockerSelfRetarget: 0,
      chocolateMagicianGirlGraveyardSummonRetarget: 0,
      toonDefenseDirectAttackConversion: 0,
      ultimateDivineBeastDivineSummonRetarget: 0,
    },
  );
}
