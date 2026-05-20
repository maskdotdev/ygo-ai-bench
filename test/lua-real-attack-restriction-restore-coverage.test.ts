import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const attackRestrictionFixtureCount = 11;
const attackRestrictionKindCounts = {
  counterGate: 1,
  faceupSetGate: 1,
  levelGate: 1,
  maleficOtherMonsterLock: 2,
  maintenanceCostGate: 1,
  remainFieldTurnCounter: 1,
  selfCostLock: 2,
  targetCountGate: 1,
  temporaryPlayerLock: 1,
} satisfies Record<AttackRestrictionKind, number>;
const attackRestrictionSemanticVariantCounts = {
  alienPsychicCounterAttackAnnounceGate: 1,
  cryomancerIceBarrierFaceupSetAttackLock: 1,
  gravityBindPersistentLevelAttackGate: 1,
  heliosphereTargetCountAttackAnnounceGate: 1,
  maleficCyberEndOtherMonsterLockSelfDestroy: 1,
  maleficRedEyesDeckOtherMonsterLockSelfDestroy: 1,
  messengerPeaceMaintenanceAtkThresholdGate: 1,
  sixSamuraiKamonCostCannotAttackAnnounce: 1,
  swordsRevealingLightRemainFieldTurnLock: 1,
  threateningRoarTemporaryPlayerAttackLock: 1,
  venomSnakeCostCannotAttackAnnounce: 1,
} satisfies Record<AttackRestrictionSemanticVariant, number>;

type AttackRestrictionKind =
  | "counterGate"
  | "faceupSetGate"
  | "levelGate"
  | "maleficOtherMonsterLock"
  | "maintenanceCostGate"
  | "remainFieldTurnCounter"
  | "selfCostLock"
  | "targetCountGate"
  | "temporaryPlayerLock";
type AttackRestrictionSemanticVariant =
  | "alienPsychicCounterAttackAnnounceGate"
  | "cryomancerIceBarrierFaceupSetAttackLock"
  | "gravityBindPersistentLevelAttackGate"
  | "heliosphereTargetCountAttackAnnounceGate"
  | "maleficCyberEndOtherMonsterLockSelfDestroy"
  | "maleficRedEyesDeckOtherMonsterLockSelfDestroy"
  | "messengerPeaceMaintenanceAtkThresholdGate"
  | "sixSamuraiKamonCostCannotAttackAnnounce"
  | "swordsRevealingLightRemainFieldTurnLock"
  | "threateningRoarTemporaryPlayerAttackLock"
  | "venomSnakeCostCannotAttackAnnounce";

describe("Lua real attack-restriction restore coverage", () => {
  it("requires representative field, player, and remain-field attack locks to assert clean Lua restore", () => {
    const files = realScriptAttackRestrictionFixtureFiles();
    expect(files).toHaveLength(attackRestrictionFixtureCount);

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
          || !text.includes("CanAttack")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps attack-restriction fixture kinds explicit", () => {
    expect(countAttackRestrictionKinds(realScriptAttackRestrictionFixtureFiles())).toEqual(attackRestrictionKindCounts);
  });

  it("keeps named attack-restriction semantic variants explicit", () => {
    expect(countAttackRestrictionSemanticVariants(realScriptAttackRestrictionSemanticVariants())).toEqual(attackRestrictionSemanticVariantCounts);

    const weak = realScriptAttackRestrictionSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function realScriptAttackRestrictionFixtureFiles(): Array<{
  file: string;
  kind: AttackRestrictionKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-cryomancer-ice-barrier-attack-lock.test.ts",
      kind: "faceupSetGate",
      required: [
        "restores aux.FaceupFilter setcode condition for its Level attack-announcement lock",
        "EFFECT_CANNOT_ATTACK_ANNOUNCE",
        "aux.FaceupFilter(Card.IsSetCard,SET_ICE_BARRIER)",
        "cryomancer face-up ally CanAttack false/true",
      ],
    },
    {
      file: "test/lua-real-script-malefic-red-eyes-deck-attack-self-destroy.test.ts",
      kind: "maleficOtherMonsterLock",
      required: [
        "restores Malefic Deck material summon, other-monster attack lock, and missing-field self-destroy",
        "aux.AddMaleficSummonProcedure(c,CARD_REDEYES_B_DRAGON,LOCATION_DECK)",
        "EFFECT_CANNOT_ATTACK_ANNOUNCE",
        "EFFECT_SELF_DESTROY",
        "malefic red eyes CanAttack true/false",
      ],
    },
    {
      file: "test/lua-real-script-gravity-bind-persistent-attack-lock.test.ts",
      kind: "levelGate",
      required: [
        "gravity bind attack true/false",
        "highAttacker!.uid)).toBe(false)",
        "faceUp: true",
      ],
    },
    {
      file: "test/lua-real-script-heliosphere-attack-announce-lock.test.ts",
      kind: "targetCountGate",
      required: [
        "code === 86",
        "heliosphere locked CanAttack false",
        "heliosphere open CanAttack true",
        "hasAttack(actions, attacker.uid, heliosphere.uid)).toBe(false)",
        "hasAttack(actions, attacker.uid, heliosphere.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-malefic-cyber-end-attack-self-destroy.test.ts",
      kind: "maleficOtherMonsterLock",
      required: [
        'const maleficCyberEndCode = "1710476"',
        "restores Malefic Extra Deck summon, other-monster attack lock, and missing-field self-destroy",
        "EFFECT_CANNOT_ATTACK_ANNOUNCE",
        "EFFECT_SELF_DESTROY",
        "malefic cyber end CanAttack true/false",
      ],
    },
    {
      file: "test/lua-real-script-alien-psychic-counter-attack-lock.test.ts",
      kind: "counterGate",
      required: [
        "alien psychic CanAttack false/true",
        "position: \"faceUpDefense\"",
        "addDuelCardCounter(counteredAttacker",
      ],
    },
    {
      file: "test/lua-real-script-messenger-peace-maintenance-attack-lock.test.ts",
      kind: "maintenanceCostGate",
      required: [
        "messenger of peace attack true/false",
        "lifePointCostPaid",
        "eventValue: 100",
      ],
    },
    {
      file: "test/lua-real-script-swords-revealing-light-remain-lock.test.ts",
      kind: "remainFieldTurnCounter",
      required: [
        "swords of revealing light state false/true/4",
        "turnCounter: 3",
        "position: \"faceUpDefense\"",
      ],
    },
    {
      file: "test/lua-real-script-threatening-roar-temporary-attack-lock.test.ts",
      kind: "temporaryPlayerLock",
      required: [
        "code: 86",
        "targetRange: [0, 1]",
        "threatening roar attack false",
      ],
    },
    {
      file: "test/lua-real-script-kamon-destroy-replace-attack-lock.test.ts",
      kind: "selfCostLock",
      required: [
        "EFFECT_CANNOT_ATTACK_ANNOUNCE",
        "code === 86",
        "declareAttack",
        "attackerUid === kamon.uid",
      ],
    },
    {
      file: "test/lua-real-script-venom-snake-counter-custom-destroy.test.ts",
      kind: "selfCostLock",
      required: [
        "EFFECT_CANNOT_ATTACK_ANNOUNCE",
        "effectCannotAttackAnnounce",
        "venom snake CanAttack false",
        'eventName: "customEvent"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackRestrictionKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countAttackRestrictionKinds(
  fixtures: Array<{ kind: AttackRestrictionKind }>,
): Record<AttackRestrictionKind, number> {
  return fixtures.reduce<Record<AttackRestrictionKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      counterGate: 0,
      faceupSetGate: 0,
      levelGate: 0,
      maleficOtherMonsterLock: 0,
      maintenanceCostGate: 0,
      remainFieldTurnCounter: 0,
      selfCostLock: 0,
      targetCountGate: 0,
      temporaryPlayerLock: 0,
    },
  );
}

function realScriptAttackRestrictionSemanticVariants(): Array<{
  file: string;
  kind: AttackRestrictionSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-cryomancer-ice-barrier-attack-lock.test.ts",
      kind: "cryomancerIceBarrierFaceupSetAttackLock",
      required: [
        'const cryomancerCode = "23950192"',
        "restores aux.FaceupFilter setcode condition for its Level attack-announcement lock",
        "Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_ICE_BARRIER)",
        "cryomancer face-down ally CanAttack true/true",
        "cryomancer face-up ally CanAttack false/true",
      ],
    },
    {
      file: "test/lua-real-script-alien-psychic-counter-attack-lock.test.ts",
      kind: "alienPsychicCounterAttackAnnounceGate",
      required: [
        'const alienPsychicCode = "58012107"',
        "restores its summon position trigger and A-counter attack announcement restriction",
        "addDuelCardCounter(counteredAttacker",
        "position: \"faceUpDefense\"",
        "alien psychic CanAttack false/true",
      ],
    },
    {
      file: "test/lua-real-script-gravity-bind-persistent-attack-lock.test.ts",
      kind: "gravityBindPersistentLevelAttackGate",
      required: [
        'const gravityBindCode = "85742772"',
        "restores official field attack restriction by Level",
        "gravity bind attack true/false",
        "highAttacker!.uid)).toBe(false)",
        "gravity bind responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-heliosphere-attack-announce-lock.test.ts",
      kind: "heliosphereTargetCountAttackAnnounceGate",
      required: [
        'const heliosphereCode = "51043053"',
        "restores its conditional opponent cannot-attack-announce field lock",
        "code === 86",
        "heliosphere locked CanAttack false",
        "heliosphere open CanAttack true",
      ],
    },
    {
      file: "test/lua-real-script-malefic-cyber-end-attack-self-destroy.test.ts",
      kind: "maleficCyberEndOtherMonsterLockSelfDestroy",
      required: [
        'const maleficCyberEndCode = "1710476"',
        'const cyberEndCode = "1546123"',
        "c:SetUniqueOnField(1,1,aux.MaleficUniqueFilter(c),LOCATION_MZONE)",
        "hasAttack(battleActions, ally.uid, target.uid)).toBe(false)",
        "reasonEffectId: 3",
      ],
    },
    {
      file: "test/lua-real-script-malefic-red-eyes-deck-attack-self-destroy.test.ts",
      kind: "maleficRedEyesDeckOtherMonsterLockSelfDestroy",
      required: [
        'const maleficRedEyesCode = "55343236"',
        'const redEyesCode = "74677422"',
        "c:SetUniqueOnField(1,1,aux.MaleficUniqueFilter(c),LOCATION_MZONE)",
        "hasAttack(battleActions, ally.uid, target.uid)).toBe(false)",
        "reasonEffectId: 3",
      ],
    },
    {
      file: "test/lua-real-script-kamon-destroy-replace-attack-lock.test.ts",
      kind: "sixSamuraiKamonCostCannotAttackAnnounce",
      required: [
        'const kamonCode = "90397998"',
        "restores targeted Spell/Trap destruction, attack-announcement oath cost, and Six Samurai destroy replacement",
        "EFFECT_CANNOT_ATTACK_ANNOUNCE",
        "attackerUid === kamon.uid",
      ],
    },
    {
      file: "test/lua-real-script-messenger-peace-maintenance-attack-lock.test.ts",
      kind: "messengerPeaceMaintenanceAtkThresholdGate",
      required: [
        'const messengerCode = "44656491"',
        "restores official ATK-threshold attack restriction and Standby maintenance cost",
        "messenger of peace attack true/false",
        'eventName: "lifePointCostPaid"',
        "eventValue: 100",
      ],
    },
    {
      file: "test/lua-real-script-swords-revealing-light-remain-lock.test.ts",
      kind: "swordsRevealingLightRemainFieldTurnLock",
      required: [
        'const swordsCode = "72302403"',
        "restores position reveal, remain-field state, and opponent attack restriction",
        "swords of revealing light state false/true/4",
        "turnCounter: 3",
        "position: \"faceUpDefense\"",
      ],
    },
    {
      file: "test/lua-real-script-threatening-roar-temporary-attack-lock.test.ts",
      kind: "threateningRoarTemporaryPlayerAttackLock",
      required: [
        'const roarCode = "36361633"',
        "restores a Trap-registered player-target attack-announcement lock until the End Phase",
        "code: 86",
        "targetRange: [0, 1]",
        "threatening roar attack false",
      ],
    },
    {
      file: "test/lua-real-script-venom-snake-counter-custom-destroy.test.ts",
      kind: "venomSnakeCostCannotAttackAnnounce",
      required: [
        'const venomSnakeCode = "73899015"',
        "restores Venom Counter placement, cannot-attack cost, Venom Swamp ATK loss, and custom-event destruction",
        "EFFECT_CANNOT_ATTACK_ANNOUNCE",
        "venom snake CanAttack false",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackRestrictionSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countAttackRestrictionSemanticVariants(
  fixtures: Array<{ kind: AttackRestrictionSemanticVariant }>,
): Record<AttackRestrictionSemanticVariant, number> {
  return fixtures.reduce<Record<AttackRestrictionSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      alienPsychicCounterAttackAnnounceGate: 0,
      cryomancerIceBarrierFaceupSetAttackLock: 0,
      gravityBindPersistentLevelAttackGate: 0,
      heliosphereTargetCountAttackAnnounceGate: 0,
      maleficCyberEndOtherMonsterLockSelfDestroy: 0,
      maleficRedEyesDeckOtherMonsterLockSelfDestroy: 0,
      messengerPeaceMaintenanceAtkThresholdGate: 0,
      sixSamuraiKamonCostCannotAttackAnnounce: 0,
      swordsRevealingLightRemainFieldTurnLock: 0,
      threateningRoarTemporaryPlayerAttackLock: 0,
      venomSnakeCostCannotAttackAnnounce: 0,
    },
  );
}
