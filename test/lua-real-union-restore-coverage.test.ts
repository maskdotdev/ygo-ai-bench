import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const UNION_FIXTURE_COUNT = 3;
const UNION_PROCEDURE_FIXTURE_COUNT = 1;
const EQUIPPED_UNION_LOCK_FIXTURE_COUNT = 1;
const UNION_POSITION_IGNITION_FIXTURE_COUNT = 1;
const unionKindCounts = {
  equippedUnionLock: 1,
  unionPositionIgnition: 1,
  unionEquipProcedure: 1,
} satisfies Record<UnionKind, number>;
const unionProcedureVariantCounts = {
  ailinOldUnionPositionIgnition: 1,
  driverDeckReplace: 1,
  driverEquipSummonBack: 1,
  freezingBeastBattleDamageDestroy: 1,
  pilotBanishedEquipSelfSummon: 1,
  trigonBattleSummon: 1,
} satisfies Record<UnionProcedureVariant, number>;

type UnionKind = "equippedUnionLock" | "unionPositionIgnition" | "unionEquipProcedure";
type UnionProcedureVariant =
  | "ailinOldUnionPositionIgnition"
  | "driverDeckReplace"
  | "driverEquipSummonBack"
  | "freezingBeastBattleDamageDestroy"
  | "pilotBanishedEquipSelfSummon"
  | "trigonBattleSummon";

describe("Lua real Union restore coverage", () => {
  it("requires representative Union fixtures to assert clean Lua registry restore", () => {
    const files = unionFixtureFiles();
    expect(files).toHaveLength(UNION_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires Union procedure fixtures to prove grouped restored legal-action parity", () => {
    const files = unionProcedureFixtureFiles();
    expect(files).toHaveLength(UNION_PROCEDURE_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getDuelLegalActions");
      });

    expect(missing).toEqual([]);
  });

  it("requires Union procedure fixtures to pin equip relation, replacement, summon-back, and battle-trigger restore", () => {
    const files = unionProcedureFixtureFiles();
    expect(files).toHaveLength(UNION_PROCEDURE_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/location:\s*["']spellTrapZone["']/.test(text)
          || !text.includes("equippedToUid")
          || !text.includes("previousEquippedToUid")
          || !/location:\s*["']banished["']/.test(text)
          || !/location:\s*["']monsterZone["']/.test(text)
          || !/eventName:\s*["']battleDestroyed["']/.test(text)
          || !/eventName:\s*["']specialSummoned["']/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("keeps Union procedure semantic variants explicit", () => {
    expect(countUnionProcedureVariants(unionProcedureVariants())).toEqual(unionProcedureVariantCounts);

    const weak = unionProcedureVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("requires Union position ignition fixtures to restore old-rule Union status into Spell/Trap-zone effects", () => {
    const files = unionPositionIgnitionFixtureFiles();
    expect(files).toHaveLength(UNION_POSITION_IGNITION_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("aux.AddUnionProcedure(c,aux.FilterBoolFunction(Card.IsCode,84173492),true)")
          || !text.includes("e1:SetRange(LOCATION_SZONE)")
          || !text.includes("e1:SetCondition(aux.IsUnionState)")
          || !text.includes("protective soul ailin union state true/true")
          || !text.includes("category: 0x1000")
          || !text.includes('eventName: "positionChanged"')
          || !text.includes("host.messages).not.toContain");
      });

    expect(missing).toEqual([]);
  });

  it("requires equipped Union lock fixtures to preserve source-equipped lizard descriptors after restore", () => {
    const files = equippedUnionLockFixtureFiles();
    expect(files).toHaveLength(EQUIPPED_UNION_LOCK_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes('luaConditionDescriptor: "condition:source-equipped"')
          || !/range:\s*\[\s*["']spellTrapZone["']\s*\]/.test(text)
          || !text.includes("targetRange: [0, 0xff]")
          || !text.includes("canActivate")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("keeps Union fixture kinds explicit", () => {
    expect(countUnionKinds(unionFixtures())).toEqual(unionKindCounts);
  });
});

function unionFixtures(): Array<{ file: string; kind: UnionKind }> {
  return ([
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "unionEquipProcedure",
    },
    {
      file: "lua-real-script-protective-soul-ailin-union-position.test.ts",
      kind: "unionPositionIgnition",
    },
    {
      file: "lua-real-script-dragon-buster-equipped-lizard-lock.test.ts",
      kind: "equippedUnionLock",
    },
  ] satisfies Array<{ file: string; kind: UnionKind }>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function unionFixtureFiles(): string[] {
  return unionFixtures().map(({ file }) => file);
}

function unionProcedureFixtureFiles(): string[] {
  return [
    "lua-real-script-union-procedure-actions.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function unionProcedureVariants(): Array<{ file: string; kind: UnionProcedureVariant; required: string[] }> {
  return ([
    {
      file: "lua-real-script-protective-soul-ailin-union-position.test.ts",
      kind: "ailinOldUnionPositionIgnition",
      required: [
        "restores old-rule Union equip state into its Spell/Trap-zone position ignition",
        "findEffectActionByCategory(restoredUnionState.session, getLuaRestoreLegalActions(restoredUnionState, 0), ailin!.uid, 0x1000)",
        "protective soul ailin union state true/true",
        'location: "spellTrapZone"',
        "equippedToUid: target!.uid",
        'position: "faceUpDefense"',
      ],
    },
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "driverEquipSummonBack",
      required: [
        "Union Driver equip and summon-back procedure windows",
        "findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), unionDriver!.uid, 1068)",
        "location: \"spellTrapZone\", equippedToUid: target!.uid",
        "findEffectAction(restoredSummonWindow.session, getLuaRestoreLegalActions(restoredSummonWindow, 0), unionDriver!.uid, 2)",
        "previousEquippedToUid: target!.uid",
      ],
    },
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "driverDeckReplace",
      required: [
        "Union Driver replacing itself with a Union from Deck",
        "findEffectActionByCategory(restoredDriverDeckEquipWindow.session, getLuaRestoreLegalActions(restoredDriverDeckEquipWindow, 0), unionDriver!.uid, 0x40000)",
        "location: \"banished\", previousEquippedToUid: target!.uid",
        "location: \"spellTrapZone\", equippedToUid: target!.uid",
        "sourceUid === platform!.uid && (effect.code === 76 || effect.code === 347)",
      ],
    },
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "freezingBeastBattleDamageDestroy",
      required: [
        "Freezing Beast old-union battle-damage set-card destroy trigger",
        "aux.AddUnionProcedure(c,aux.FilterBoolFunction(Card.IsCode,59364406),true)",
        "e3:SetCode(EVENT_BATTLE_DAMAGE)",
        "eventName: \"battleDamageDealt\"",
        "eventName: \"destroyed\"",
        "eventReasonCardUid: freezingBeast!.uid",
        "eventReasonEffectId: 5",
      ],
    },
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "pilotBanishedEquipSelfSummon",
      required: [
        "Union Pilot cost-to-hand, banished Union equip, and self Special Summon",
        "findEffectActionByCategory(restoredEquippedState.session, getLuaRestoreLegalActions(restoredEquippedState, 0), unionPilot!.uid, 0x40200)",
        "category: 0x40000",
        "category: 0x200",
        "location: \"hand\", controller: 0, previousEquippedToUid: target!.uid",
        "location: \"spellTrapZone\", equippedToUid: target!.uid",
        "location: \"monsterZone\", controller: 0",
        "union pilot responder resolved",
      ],
    },
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "trigonBattleSummon",
      required: [
        "Trigon old-union battle-destroying Special Summon trigger",
        "action.type === \"declareAttack\"",
        "eventName: \"battleDestroyed\"",
        "eventName: \"specialSummoned\"",
        "triggerBucket: \"turnMandatory\"",
        "location: \"monsterZone\"",
        "eventReasonCardUid: trigon!.uid",
      ],
    },
  ] satisfies Array<{ file: string; kind: UnionProcedureVariant; required: string[] }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

function equippedUnionLockFixtureFiles(): string[] {
  return [
    "lua-real-script-dragon-buster-equipped-lizard-lock.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function unionPositionIgnitionFixtureFiles(): string[] {
  return [
    "lua-real-script-protective-soul-ailin-union-position.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function countUnionKinds(fixtures: Array<{ kind: UnionKind }>): Record<UnionKind, number> {
  return fixtures.reduce<Record<UnionKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      equippedUnionLock: 0,
      unionPositionIgnition: 0,
      unionEquipProcedure: 0,
    },
  );
}

function countUnionProcedureVariants(fixtures: Array<{ kind: UnionProcedureVariant }>): Record<UnionProcedureVariant, number> {
  return fixtures.reduce<Record<UnionProcedureVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      ailinOldUnionPositionIgnition: 0,
      driverDeckReplace: 0,
      driverEquipSummonBack: 0,
      freezingBeastBattleDamageDestroy: 0,
      pilotBanishedEquipSelfSummon: 0,
      trigonBattleSummon: 0,
    },
  );
}
