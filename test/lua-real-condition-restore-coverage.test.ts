import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const conditionFixtureCount = 7;
const sourceConditionFixtureCount = 60;

describe("Lua real condition restore coverage", () => {
  it("requires representative phase and turn-player condition fixtures to assert clean Lua registry restore", () => {
    const files = realScriptConditionFixtureFiles();
    expect(files).toHaveLength(conditionFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)");
      });

    expect(missing).toEqual([]);
  });

  it("requires restored condition fixtures to prove descriptor-backed truth tables", () => {
    const files = realScriptConditionFixtureFiles();
    expect(files).toHaveLength(conditionFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("luaConditionDescriptor")
          || !text.includes("canActivate")
          || !text.includes("targetContext(restored.session.state")
          || !text.includes("toBe(true)")
          || !text.includes("toBe(false)")
          || (!file.endsWith("lua-real-script-turn-player-condition.test.ts") && !text.includes("restored.session.state.phase"))
          || (file.includes("turn-player") && !text.includes("restored.session.state.turnPlayer"));
      });

    expect(missing).toEqual([]);
  });

  it("requires representative source condition fixtures to prove restored source-state truth tables", () => {
    const files = realScriptSourceConditionFixtureFiles();
    expect(files).toHaveLength(sourceConditionFixtureCount);

    const missing = files
      .filter(({ file, requiredSnippets }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("luaConditionDescriptor")
          || !text.includes("canActivate")
          || !text.includes("targetContext(restored.session.state")
          || !text.includes("toBe(true)")
          || !text.includes("toBe(false)")
          || !requiredSnippets.every((snippet) => text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptConditionFixtureFiles(): string[] {
  return [
    "lua-real-script-main-or-battle-phase-condition.test.ts",
    "lua-real-script-named-phase-condition.test.ts",
    "lua-real-script-phase-condition.test.ts",
    "lua-real-script-turn-player-battle-phase-condition.test.ts",
    "lua-real-script-turn-player-condition.test.ts",
    "lua-real-script-turn-player-main-phase-condition.test.ts",
    "lua-real-script-turn-player-phase-condition.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptSourceConditionFixtureFiles(): Array<{ file: string; requiredSnippets: string[] }> {
  return [
    {
      file: "test/lua-real-script-source-status-condition.test.ts",
      requiredSnippets: [
        "condition:source-status:",
        "restoredHound!.summonType = \"normal\"",
        "restoredHound!.customStatusMask = statusSpecialSummonTurn",
      ],
    },
    {
      file: "test/lua-real-script-source-status-not-condition.test.ts",
      requiredSnippets: [
        "condition:source-status-not:",
        "restoredVennominaga!.customStatusMask = statusBattleDestroyed",
      ],
    },
    {
      file: "test/lua-real-script-source-status-relate-battle-condition.test.ts",
      requiredSnippets: [
        "condition:source-status-relate-battle:",
        "numeron-comma-local-status-relate-battle-condition.lua",
        "currentAttack = { attackerUid: restoredTarget!.uid, targetUid: restoredNumeron!.uid }",
        "pendingBattle = { attackerUid: restoredTarget!.uid }",
      ],
    },
    {
      file: "test/lua-real-script-source-status-summon-type-condition.test.ts",
      requiredSnippets: [
        "condition:source-status-summon-type:",
        "sprind-comma-local-status-link-summon-condition.lua",
        "restoredSprind!.summonType = \"xyz\"",
        "delete restoredSprind!.summonType",
      ],
    },
    {
      file: "test/lua-real-script-darklord-eveningstar-fusion-summon-condition.test.ts",
      requiredSnippets: [
        "condition:source-summon-type:",
        "darklord-eveningstar-official-comma-local-fusion-summon-condition.lua",
        "restoredEveningstar!.summonType = \"special\"",
        "delete restoredEveningstar!.summonTypeCode",
      ],
    },
    {
      file: "test/lua-real-script-newbee-summon-location-condition.test.ts",
      requiredSnippets: [
        "condition:source-summon-location:2",
        "newbee-official-summon-location-condition.lua",
        'restoredNewbee!.previousLocation = "graveyard"',
        "delete restoredNewbee!.summonType",
      ],
    },
    {
      file: "test/lua-real-script-source-battle-target-controller-condition.test.ts",
      requiredSnippets: [
        "condition:source-battle-target-opponent",
        "sigma-official-local-source-battle-target-opponent-condition.lua",
        "restoredTarget!.controller = restoredSigma!.controller",
        "currentAttack = { attackerUid: restoredSigma!.uid }",
      ],
    },
    {
      file: "test/lua-real-script-source-battle-target-race-condition.test.ts",
      requiredSnippets: [
        "condition:source-battle-target-race:",
        "rose-official-local-battle-target-race-condition.lua",
        "restoredTarget!.data.race = raceDragon",
        "currentAttack = { attackerUid: restoredRose!.uid }",
      ],
    },
    {
      file: "test/lua-real-script-source-battle-target-monster-condition.test.ts",
      requiredSnippets: [
        "condition:source-relate-battle-target-monster",
        "blizzard-warrior-official-direct-battle-target-monster-condition.lua",
        "restoredTarget!.data.typeFlags = 0",
        "currentAttack = { attackerUid: restoredBlizzardWarrior!.uid }",
      ],
    },
    {
      file: "test/lua-real-script-source-battle-target-attribute-condition.test.ts",
      requiredSnippets: [
        "condition:source-battle-target-attribute:",
        "brain-golem-official-local-battle-target-attribute-condition.lua",
        "restoredTarget!.data.attribute = attributeDark",
        "currentAttack = { attackerUid: restoredBrainGolem!.uid }",
      ],
    },
    {
      file: "test/lua-real-script-source-battle-target-condition.test.ts",
      requiredSnippets: [
        "condition:source-battle-target",
        "basilisk-official-local-battle-target-condition.lua",
        "pendingBattle = { attackerUid: restoredBasilisk!.uid, targetUid: restoredTarget!.uid }",
        "currentAttack = { attackerUid: restoredBasilisk!.uid }",
      ],
    },
    {
      file: "test/lua-real-script-source-battle-target-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-relate-battle-target-reason:",
        "memorygant-official-direct-battle-target-reason-condition.lua",
        "eventReason: duelReason.battle",
        "currentAttack = { attackerUid: restoredMemorygant!.uid }",
      ],
    },
    {
      file: "test/lua-real-script-damage-source-relate-battle-target-condition.test.ts",
      requiredSnippets: [
        "condition:damage-source-relate-battle-target",
        "restored.session.state.battleStep = \"damage\"",
        "restored.session.state.battleStep = \"damageCalculation\"",
        "currentAttack = { attackerUid: restoredRoboyarou!.uid }",
      ],
    },
    {
      file: "test/lua-real-script-previous-location-battle-target-controller-condition.test.ts",
      requiredSnippets: [
        "condition:source-battle-target-opponent-previous-location-reason-player:",
        "eventReasonPlayer: 1",
        "restoredDispatchparazzi!.previousLocation = \"hand\"",
        "restoredTarget!.controller = 0",
      ],
    },
    {
      file: "test/lua-real-script-source-location-battle-target-race-condition.test.ts",
      requiredSnippets: [
        "category: 0x80000",
        "condition:source-battle-target-race-source-location:",
        "oxygeddon-official-local-location-battle-target-race-condition.lua",
        "restoredTarget!.data.race = raceDragon",
        'moveDuelCard(restored.session.state, restoredOxygeddon!.uid, "monsterZone", 0)',
      ],
    },
    {
      file: "test/lua-real-script-source-status-battle-target-control-condition.test.ts",
      requiredSnippets: [
        "condition:source-status-battle-target-control:",
        "sarcoughagus-comma-local-status-battle-target-control-condition.lua",
        "pendingBattle = { attackerUid: restoredTarget!.uid, targetUid: restoredSarcoughagus!.uid }",
        'restoredTarget!.location = "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-cursed-copycat-equipped-target-race-condition.test.ts",
      requiredSnippets: [
        "condition:equipped-target-race:",
        "cursed-copycat-official-local-handler-equipped-target-race.lua",
        "restoredCopycat!.equippedToUid = restoredMachine!.uid",
        "delete restoredCopycat!.equippedToUid",
      ],
    },
    {
      file: "test/lua-real-script-therion-equipped-target-setcode-condition.test.ts",
      requiredSnippets: [
        "condition:equipped-target-setcode:",
        "therion-regulus-official-local-handler-equipped-target-setcode.lua",
        "restoredRegulus!.equippedToUid = restoredOffSet!.uid",
        "delete restoredRegulus!.equippedToUid",
      ],
    },
    {
      file: "test/lua-real-script-xyz-armor-torpedo-equipped-target-type-condition.test.ts",
      requiredSnippets: [
        "condition:equipped-target-type:",
        "xyz-armor-torpedo-official-local-handler-equipped-target-type.lua",
        "restoredArmor!.equippedToUid = restoredNonXyz!.uid",
        "delete restoredArmor!.equippedToUid",
      ],
    },
    {
      file: "test/lua-real-script-source-controller-condition.test.ts",
      requiredSnippets: [
        "condition:source-controller",
        "restoredSource!.controller = 1",
        "source-controller-condition.lua",
      ],
    },
    {
      file: "test/lua-real-script-source-previous-controller-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller",
        "steelswarm-sting-official-previous-controller-condition.lua",
        "restoredSting!.previousController = 1",
        "delete restoredSting!.previousController",
      ],
    },
    {
      file: "test/lua-real-script-source-get-previous-controller-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller-reason-player:opponent",
        "wattfox-official-get-previous-controller-condition.lua",
        "restoredWattfox!.reasonPlayer = 0",
        "delete restoredWattfox!.previousController",
      ],
    },
    {
      file: "test/lua-real-script-previous-controller-previous-location-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller-previous-location:",
        "dark-tinker-comma-local-previous-controller-location-condition.lua",
        "restoredDarkTinker!.previousLocation = \"deck\"",
        "restoredDarkTinker!.previousController = 1",
      ],
    },
    {
      file: "test/lua-real-script-previous-controller-opponent-previous-location-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller-side-previous-location:",
        "veidos-comma-local-opponent-previous-controller-location-condition.lua",
        "restoredVeidos!.previousController = 0",
        "restoredVeidos!.previousLocation = \"deck\"",
      ],
    },
    {
      file: "test/lua-real-script-previous-controller-previous-location-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller-previous-location-reason:",
        "asmodeus-comma-local-previous-controller-location-reason-condition.lua",
        "asmodeus-card-filter-previous-controller-location-reason-condition.lua",
        "restoredAsmodeus!.previousLocation = \"deck\"",
      ],
    },
    {
      file: "test/lua-real-script-previous-controller-previous-location-reason-player-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller-previous-location-reason-player:",
        "coppelia-comma-local-previous-controller-previous-location-reason-player-condition.lua",
        "eventReasonPlayer: 1",
        "restoredRanshin!.previousLocation = \"deck\"",
      ],
    },
    {
      file: "test/lua-real-script-previous-controller-reason-player-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller-reason-player:opponent",
        "windaCode",
        "restoredWinda!.reasonPlayer = 0",
        "restoredWinda!.previousController = 1",
      ],
    },
    {
      file: "test/lua-real-script-previous-controller-reason-player-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller-reason-player-reason:",
        "mikorange-comma-local-previous-controller-reason-player-reason-condition.lua",
        "eventReasonPlayer: 1",
        "eventReason: duelReason.destroy",
        "restoredMikorange!.previousController = 1",
      ],
    },
    {
      file: "test/lua-real-script-previous-controller-location-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller-location-reason:",
        "defender-comma-local-previous-controller-current-location-reason-condition.lua",
        "defender-previous-controller-first-current-location-reason-condition.lua",
        "eventReason: duelReason.battle",
      ],
    },
    {
      file: "test/lua-real-script-source-location-condition.test.ts",
      requiredSnippets: [
        'luaConditionDescriptor: "condition:source-location:16"',
        'luaConditionDescriptor: "condition:source-location:18"',
        "panzer-dragon-official-source-location-condition.lua",
        'moveDuelCard(restored.session.state, restoredPanzer!.uid, "hand", 0)',
      ],
    },
    {
      file: "test/lua-real-script-source-location-not-condition.test.ts",
      requiredSnippets: [
        'luaConditionDescriptor: "condition:source-location-not:64"',
        'luaConditionDescriptor: "condition:source-location-not:80"',
        "panzer-dragon-official-source-location-not-condition.lua",
        'moveDuelCard(restored.session.state, restoredPanzer!.uid, "extraDeck", 0)',
      ],
    },
    {
      file: "test/lua-real-script-source-location-reason-condition.test.ts",
      requiredSnippets: [
        'luaConditionDescriptor: "condition:source-location-reason:16:32"',
        "panzer-dragon-official-source-location-reason-condition.lua",
        "panzer-dragon-source-reason-location-condition.lua",
        "eventReason: duelReason.battle",
      ],
    },
    {
      file: "test/lua-real-script-source-location-get-reason-condition.test.ts",
      requiredSnippets: [
        'luaConditionDescriptor: "condition:source-location-reason:16:32"',
        "panzer-dragon-official-source-location-get-reason-condition.lua",
        "GetReason()&REASON_BATTLE",
        'moveDuelCard(restored.session.state, restoredPanzer!.uid, "hand", 0)',
      ],
    },
    {
      file: "test/lua-real-script-source-previous-location-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-location:",
        "flipping-feline-official-previous-location-condition.lua",
        "restoredFeline!.previousLocation = \"deck\"",
        "delete restoredFeline!.previousLocation",
      ],
    },
    {
      file: "test/lua-real-script-source-get-previous-location-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-location:",
        "baby-roc-official-get-previous-location-condition.lua",
        "vylon-tetra-official-local-get-previous-location-condition.lua",
        "delete restoredBabyRoc!.previousLocation",
      ],
    },
    {
      file: "test/lua-real-script-source-get-previous-location-bitmask-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-location:",
        "worm-hope-official-get-previous-location-bitmask-condition.lua",
        "restoredWormHope!.previousLocation = \"spellTrapZone\"",
        "delete restoredWormHope!.previousLocation",
      ],
    },
    {
      file: "test/lua-real-script-source-get-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-reason:",
        "restoredPanzer!.reason = duelReason.destroy | duelReason.effect",
        "delete restoredPanzer!.reason",
      ],
    },
    {
      file: "test/lua-real-script-source-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-reason:",
        "restoredPanzer!.reason = duelReason.effect",
        "eventReason: duelReason.destroy",
        "delete restoredPanzer!.reason",
      ],
    },
    {
      file: "test/lua-real-script-source-reason-not-condition.test.ts",
      requiredSnippets: [
        "condition:source-reason-not:",
        "restoredPanzer!.reason = duelReason.effect | duelReason.battle",
        "eventReason: duelReason.effect",
        "delete restoredPanzer!.reason",
      ],
    },
    {
      file: "test/lua-real-script-source-get-reason-all-condition.test.ts",
      requiredSnippets: [
        "condition:source-reason-all:",
        "restoredPanzer!.reason = duelReason.destroy",
        "eventReason: duelReason.destroy | duelReason.effect",
        "restoredPanzer!.reason = duelReason.destroy | duelReason.effect | duelReason.battle",
      ],
    },
    {
      file: "test/lua-real-script-source-reason-player-condition.test.ts",
      requiredSnippets: [
        'luaConditionDescriptor: "condition:source-reason-player:opponent"',
        'luaConditionDescriptor: "condition:source-reason-player:self"',
        "restoredPanzer!.reasonPlayer = 0",
        "delete restoredPanzer!.reasonPlayer",
      ],
    },
    {
      file: "test/lua-real-script-source-overlay-count-condition.test.ts",
      requiredSnippets: [
        "condition:source-overlay-count-positive",
        "condition:source-overlay-count-zero",
        "sargas-official-overlay-count-condition.lua",
        "restoredSargas!.overlayUids = []",
      ],
    },
    {
      file: "test/lua-real-script-source-previous-location-reason-condition.test.ts",
      requiredSnippets: [
        'luaConditionDescriptor: "condition:source-previous-location-reason:12:1"',
        "panzer-dragon-official-source-previous-location-reason-condition.lua",
        "restoredPanzer).toMatchObject({ previousLocation: \"monsterZone\", reason: duelReason.destroy })",
      ],
    },
    {
      file: "test/lua-real-script-local-previous-location-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-location-reason:",
        "red-duston-comma-local-previous-location-reason-condition.lua",
        "restoredRedDuston!.reason = duelReason.effect",
        "restoredRedDuston!.previousLocation = \"deck\"",
      ],
    },
    {
      file: "test/lua-real-script-source-previous-location-reason-not-condition.test.ts",
      requiredSnippets: [
        'luaConditionDescriptor: "condition:source-previous-location-reason-not:12:32"',
        "panzer-dragon-official-source-previous-location-reason-not-condition.lua",
        "eventReason: duelReason.effect",
        "delete restoredPanzer!.reason",
      ],
    },
    {
      file: "test/lua-real-script-source-get-previous-location-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-location-reason:",
        "infernityKnightCode",
        "restoredInfernityKnight!.reason = duelReason.destroy",
        "restoredInfernityKnight!.previousLocation = \"hand\"",
      ],
    },
    {
      file: "test/lua-real-script-source-previous-position-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-position:",
        "shore-knight-official-previous-position-condition.lua",
        "ranvier-official-local-previous-position-condition.lua",
        "delete restoredShoreKnight!.previousPosition",
      ],
    },
    {
      file: "test/lua-real-script-source-get-previous-position-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-position:",
        "vylon-segment-official-get-previous-position-condition.lua",
        "dream-clown-official-local-get-previous-position-condition.lua",
        "delete restoredSegment!.previousPosition",
      ],
    },
    {
      file: "test/lua-real-script-previous-position-location-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-position-location:",
        "blue-eyes-jet-comma-local-previous-position-location-condition.lua",
        "restoredBlueEyesJetDragon!.previousLocation = \"hand\"",
        "restoredSupervise!.previousLocation = \"deck\"",
      ],
    },
    {
      file: "test/lua-real-script-source-previous-position-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-position-reason:",
        "panzer-dragon-official-source-previous-position-reason-condition.lua",
        "eventReason: duelReason.destroy",
        "delete restoredPanzer!.previousPosition",
      ],
    },
    {
      file: "test/lua-real-script-previous-position-current-position-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-position-position:",
        "samurai-comma-local-previous-current-position-condition.lua",
        "restoredSamurai!.position = \"faceUpAttack\"",
        "restoredSamurai!.previousPosition = \"faceUpDefense\"",
      ],
    },
    {
      file: "test/lua-real-script-location-reason-previous-position-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-position-location-reason:",
        "poison-cloud-comma-local-location-reason-previous-position-condition.lua",
        "restoredPoisonCloud!.previousPosition = \"faceDownDefense\"",
        "restoredPoisonCloud!.location = \"monsterZone\"",
      ],
    },
    {
      file: "test/lua-real-script-previous-position-location-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-position-location-reason:",
        "wisp-comma-local-previous-position-location-reason-condition.lua",
        "eventReason: duelReason.battle",
        "restoredWisp!.location = \"monsterZone\"",
      ],
    },
    {
      file: "test/lua-real-script-previous-controller-previous-position-location-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller-previous-position-location-reason:",
        "gigastone-comma-local-previous-controller-position-location-reason-condition.lua",
        "eventReason: duelReason.destroy",
        "restoredGigastone!.previousLocation = \"spellTrapZone\"",
      ],
    },
    {
      file: "test/lua-real-script-previous-controller-previous-position-location-activated-reason-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller-previous-position-location-reason-player-reason:",
        "struggleCode",
        "eventReasonPlayer: 1",
        "restoredStruggle!.previousLocation = \"hand\"",
      ],
    },
    {
      file: "test/lua-real-script-previous-controller-previous-position-location-reason-player-condition.test.ts",
      requiredSnippets: [
        "condition:source-previous-controller-previous-position-location-reason-player-reason:",
        "tongueCode",
        "eventReasonPlayer: 1",
        "restoredTongue!.previousLocation = \"hand\"",
      ],
    },
    {
      file: "test/lua-real-script-source-turn-current-condition.test.ts",
      requiredSnippets: [
        'luaConditionDescriptor: "condition:source-turn-current"',
        "turnId = restored.session.state.turn",
      ],
    },
    {
      file: "test/lua-real-script-source-turn-current-reason-not-condition.test.ts",
      requiredSnippets: [
        "condition:source-turn-current-reason-not:",
        "titaniklad-comma-local-current-turn-reason-not-condition.lua",
        "eventReason: duelReason.effect",
        "restoredTitaniklad!.turnId = restored.session.state.turn - 1",
      ],
    },
    {
      file: "test/lua-real-script-source-turn-next-condition.test.ts",
      requiredSnippets: [
        'luaConditionDescriptor: "condition:source-turn-next"',
        "turnId = restored.session.state.turn",
      ],
    },
    {
      file: "test/lua-real-script-source-turn-not-current-condition.test.ts",
      requiredSnippets: [
        'luaConditionDescriptor: "condition:source-turn-not-current"',
        "turnId = restored.session.state.turn",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
