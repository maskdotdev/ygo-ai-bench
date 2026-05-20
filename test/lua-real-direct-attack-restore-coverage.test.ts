import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const DIRECT_ATTACK_FIXTURE_COUNT = 9;
const directAttackKindCounts = {
  cannotDirectAttack: 1,
  conditionalDirectAttack: 1,
  directAttackConversion: 1,
  directAttackDamageStatTrigger: 1,
  directAttackGroupGrant: 1,
  directAttackOnly: 1,
  directAttackPermission: 1,
  directAttackTrigger: 1,
  directTargetLock: 1,
} satisfies Record<DirectAttackKind, number>;
const directAttackSemanticVariantCounts = {
  blackTyrannoConditionalDirectAttack: 1,
  dragonicHalberdCannotDirectLock: 1,
  drillBarnacleDirectDamageAtkGain: 1,
  hayateDirectAttackBattledSendTrigger: 1,
  inabaWhiteRabbitDirectOnlyDamage: 1,
  jinzoSevenDirectAttackOption: 1,
  reverseBusterDirectFaceUpTargetLock: 1,
  toonDefenseAttackToDirectConversion: 1,
  deltaAttackerGroupDirectGrant: 1,
} satisfies Record<DirectAttackSemanticVariant, number>;

type DirectAttackKind =
  | "cannotDirectAttack"
  | "conditionalDirectAttack"
  | "directAttackConversion"
  | "directAttackDamageStatTrigger"
  | "directAttackGroupGrant"
  | "directAttackOnly"
  | "directAttackPermission"
  | "directAttackTrigger"
  | "directTargetLock";
type DirectAttackSemanticVariant =
  | "blackTyrannoConditionalDirectAttack"
  | "dragonicHalberdCannotDirectLock"
  | "deltaAttackerGroupDirectGrant"
  | "drillBarnacleDirectDamageAtkGain"
  | "hayateDirectAttackBattledSendTrigger"
  | "inabaWhiteRabbitDirectOnlyDamage"
  | "jinzoSevenDirectAttackOption"
  | "reverseBusterDirectFaceUpTargetLock"
  | "toonDefenseAttackToDirectConversion";

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

  it("keeps named direct-attack semantic variants explicit", () => {
    expect(countDirectAttackSemanticVariants(directAttackSemanticVariants())).toEqual(directAttackSemanticVariantCounts);

    const weak = directAttackSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function realScriptDirectAttackFixtureFiles(): Array<{
  file: string;
  kind: DirectAttackKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-black-tyranno-conditional-direct.test.ts",
      kind: "conditionalDirectAttack",
      required: [
        "Duel.GetFieldGroupCount(tp,0,LOCATION_SZONE)==0",
        "not Duel.IsExistingMatchingCard(Card.IsAttackPos,tp,0,LOCATION_MZONE,1,nil)",
        "hasDirectAttack(openActions, openTyranno.uid)).toBe(true)",
        "hasDirectAttack(attackBlockedActions, blockedTyranno.uid)).toBe(false)",
        "hasDirectAttack(spellBlockedActions, spellBlockedTyranno.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-delta-attacker-group-direct-attack.test.ts",
      kind: "directAttackGroupGrant",
      required: [
        "Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil,tp)",
        "for tc in aux.Next(g) do",
        "e1:SetCode(EFFECT_DIRECT_ATTACK)",
        "hasDirectAttack(battleActions, normal.uid)).toBe(true)",
        "hasDirectAttack(battleActions, effectDecoy.uid)).toBe(false)",
        "battleDamage[1]).toBe(1000)",
      ],
    },
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
      file: "test/lua-real-script-drill-barnacle-direct-damage-atk.test.ts",
      kind: "directAttackDamageStatTrigger",
      required: [
        "e1:SetCode(EFFECT_DIRECT_ATTACK)",
        "return ep~=tp and Duel.GetAttackTarget()==nil",
        "eventName: \"battleDamageDealt\"",
        "currentAttack(restoredBoost.session.state.cards.find",
      ],
    },
    {
      file: "test/lua-real-script-hayate-battled-send.test.ts",
      kind: "directAttackTrigger",
      required: [
        "directAttack === true",
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'eventName: "sentToGraveyard"',
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
      conditionalDirectAttack: 0,
      directAttackConversion: 0,
      directAttackDamageStatTrigger: 0,
      directAttackGroupGrant: 0,
      directAttackOnly: 0,
      directAttackPermission: 0,
      directAttackTrigger: 0,
      directTargetLock: 0,
    },
  );
}

function directAttackSemanticVariants(): Array<{
  file: string;
  kind: DirectAttackSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-black-tyranno-conditional-direct.test.ts",
      kind: "blackTyrannoConditionalDirectAttack",
      required: [
        'const blackTyrannoCode = "38670435"',
        "restores S/T count and Attack Position monster gated direct attack permission",
        "Duel.GetFieldGroupCount(tp,0,LOCATION_SZONE)==0",
        "not Duel.IsExistingMatchingCard(Card.IsAttackPos,tp,0,LOCATION_MZONE,1,nil)",
      ],
    },
    {
      file: "test/lua-real-script-delta-attacker-group-direct-attack.test.ts",
      kind: "deltaAttackerGroupDirectGrant",
      required: [
        'const deltaAttackerCode = "39719977"',
        "restores operation-registered direct attack effects for three same-code face-up Normal monsters",
        "Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,3,nil,tp)",
        "for tc in aux.Next(g) do",
      ],
    },
    {
      file: "test/lua-real-script-dragonic-halberd-cannot-direct.test.ts",
      kind: "dragonicHalberdCannotDirectLock",
      required: [
        'const halberdCode = "2896663"',
        "restores its direct-attack lock while ordinary attackers stay legal",
        "hasDirectAttack(actions, halberd.uid)).toBe(false)",
        "hasDirectAttack(actions, ordinary.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-drill-barnacle-direct-damage-atk.test.ts",
      kind: "drillBarnacleDirectDamageAtkGain",
      required: [
        'const drillBarnacleCode = "24137081"',
        "restores its direct attack permission and mandatory battle-damage ATK gain",
        "e2:SetCode(EVENT_BATTLE_DAMAGE)",
        "eventName: \"battleDamageDealt\"",
        "currentAttack(restoredBoost.session.state.cards.find",
      ],
    },
    {
      file: "test/lua-real-script-hayate-battled-send.test.ts",
      kind: "hayateDirectAttackBattledSendTrigger",
      required: [
        'const hayateCode = "8491308"',
        "restores its direct-attack EVENT_BATTLED trigger and sends a Sky Striker card from Deck to Graveyard",
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "sentToGraveyard"',
      ],
    },
    {
      file: "test/lua-real-script-inaba-white-rabbit-direct-only.test.ts",
      kind: "inabaWhiteRabbitDirectOnlyDamage",
      required: [
        'const inabaCode = "77084837"',
        "restores its direct-attack-only legal action surface and direct battle damage",
        "directAttack: true",
        "battleDamage).toEqual({ 0: 0, 1: 700 })",
      ],
    },
    {
      file: "test/lua-real-script-jinzo-seven-direct-attack.test.ts",
      kind: "jinzoSevenDirectAttackOption",
      required: [
        'const jinzoCode = "32809211"',
        "restores its direct attack option while preserving monster attacks",
        "hasAttack(actions, jinzo.uid, defender.uid)).toBe(true)",
        "hasDirectAttack(actions, jinzo.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-reverse-buster-direct-target-lock.test.ts",
      kind: "reverseBusterDirectFaceUpTargetLock",
      required: [
        'const busterCode = "90640901"',
        "restores cannot-direct and cannot-select face-up battle target locks",
        'luaValueDescriptor: "value-card:not-facedown"',
        "hasAttack(actions, buster.uid, faceDownTarget.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-toon-defense-change-attack-target.test.ts",
      kind: "toonDefenseAttackToDirectConversion",
      required: [
        'const toonDefenseCode = "43509019"',
        "restores Toon Defense's attack-declaration trigger and changes the attack into a direct attack",
        "currentAttack?.targetUid).toBeUndefined()",
        "battleDamage).toMatchObject({ 1: 1800 })",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DirectAttackSemanticVariant;
    required: string[];
  }>);
}

function countDirectAttackSemanticVariants(
  fixtures: Array<{ kind: DirectAttackSemanticVariant }>,
): Record<DirectAttackSemanticVariant, number> {
  return fixtures.reduce<Record<DirectAttackSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      blackTyrannoConditionalDirectAttack: 0,
      deltaAttackerGroupDirectGrant: 0,
      dragonicHalberdCannotDirectLock: 0,
      drillBarnacleDirectDamageAtkGain: 0,
      hayateDirectAttackBattledSendTrigger: 0,
      inabaWhiteRabbitDirectOnlyDamage: 0,
      jinzoSevenDirectAttackOption: 0,
      reverseBusterDirectFaceUpTargetLock: 0,
      toonDefenseAttackToDirectConversion: 0,
    },
  );
}
