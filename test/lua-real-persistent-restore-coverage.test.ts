import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const PERSISTENT_FIXTURE_COUNT = 17;
const TARGETED_PERSISTENT_FIXTURE_COUNT = 13;
const REVIVE_DESTROY_PERSISTENT_FIXTURE_COUNT = 2;
const SPIRITS_INVITATION_PERSISTENT_FIXTURE_COUNT = 1;
const ATTACK_LOCK_PERSISTENT_FIXTURE_COUNT = 9;
const persistentKindCounts = {
  chainSolvingNegate: 1,
  fieldAttackOrPositionLock: 4,
  persistentDamage: 3,
  protection: 1,
  ritualOverlay: 1,
  specialSummonLock: 1,
  statModifier: 3,
  targetedDisableOrLock: 3,
} satisfies Record<PersistentKind, number>;

type PersistentKind =
  | "chainSolvingNegate"
  | "fieldAttackOrPositionLock"
  | "persistentDamage"
  | "protection"
  | "ritualOverlay"
  | "specialSummonLock"
  | "statModifier"
  | "targetedDisableOrLock";

describe("Lua real persistent restore coverage", () => {
  it("requires representative persistent/remaining-field fixtures to assert grouped legal actions and clean Lua registry restore", () => {
    const files = realScriptPersistentFixtureFiles();
    expect(files).toHaveLength(PERSISTENT_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("keeps persistent fixture kinds explicit", () => {
    expect(countPersistentKinds(realScriptPersistentFixtures())).toEqual(persistentKindCounts);
  });

  it("requires representative persistent/remaining-field fixtures to prove restored field state and response suppression", () => {
    const files = realScriptPersistentFixtureFiles();
    expect(files).toHaveLength(PERSISTENT_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/location:\s*["']spellTrapZone["']/.test(text)
          || !text.includes("host.messages).not.toContain")
          || !text.includes("host.messages).toContain");
      });

    expect(missing).toEqual([]);
  });

  it("requires targeted persistent fixtures to prove card target relations survive restore", () => {
    const files = realScriptTargetedPersistentFixtureFiles();
    expect(files).toHaveLength(TARGETED_PERSISTENT_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("cardTargetUids");
      });

    expect(missing).toEqual([]);
  });

  it("requires revive-destroy persistent fixtures to prove restored relation cleanup and clean Lua registry restore", () => {
    const fixtures = realScriptReviveDestroyPersistentFixtureFiles();
    expect(fixtures).toHaveLength(REVIVE_DESTROY_PERSISTENT_FIXTURE_COUNT);

    const missing = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires Spirit's Invitation to prove restored previous-state bounce and maintenance branches", () => {
    const fixtures = spiritsInvitationPersistentFixtureFiles();
    expect(fixtures).toHaveLength(SPIRITS_INVITATION_PERSISTENT_FIXTURE_COUNT);

    const missing = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires attack-lock persistent fixtures to prove restored illegal attacks stay hidden", () => {
    const files = realScriptAttackLockPersistentFixtureFiles();
    expect(files).toHaveLength(ATTACK_LOCK_PERSISTENT_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes('type === "declareAttack"')
          || !text.includes("toBe(false)");
      });

    expect(missing).toEqual([]);
  });
});

function realScriptPersistentFixtureFiles(): string[] {
  return realScriptPersistentFixtures().map(({ file }) => file);
}

function realScriptTargetedPersistentFixtureFiles(): string[] {
  return realScriptPersistentFixtureFiles()
    .filter((file) =>
      !file.includes("gravity-bind")
      && !file.includes("level-limit")
      && !file.includes("messenger-peace")
      && !file.includes("swords-revealing-light")
    );
}

function realScriptReviveDestroyPersistentFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-call-of-the-haunted-revive-destroy.test.ts",
      required: [
        "cardTargetUids: [target!.uid]",
        "expectLuaCallProbe(restoredRevive, targetCode, callCode, \"call probe 0/612701/1\")",
        "destroyDuelCard(restoredRevive.session.state, call!.uid, 0, duelReason.effect | duelReason.destroy, 0)",
        "destroyDuelCard(restoredTargetDestroy.session.state, target!.uid, 0, duelReason.effect | duelReason.destroy, 0)",
        "expect(restoredChain.host.messages).not.toContain(\"call responder resolved\")",
      ],
    },
    {
      file: "test/lua-real-script-premature-burial-revive-destroy.test.ts",
      required: [
        "cardTargetUids: [target!.uid]",
        "expectLuaPrematureProbe(restoredEquipped, targetCode, prematureCode, \"premature probe 0/612601/612601/1\")",
        "destroyDuelCard(restoredEquipped.session.state, premature!.uid, 0, duelReason.effect | duelReason.destroy, 0)",
        "previousEquippedToUid: target!.uid",
        "previousLocation: \"monsterZone\"",
        "expect(restoredChain.host.messages).not.toContain(\"premature responder resolved\")",
      ],
    },
  ];
}

function spiritsInvitationPersistentFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-spirits-invitation-return-bounce.test.ts",
      required: [
        "Spirit's Invitation return bounce",
        "eventName: \"sentToHand\"",
        "eventCardUid: susa!.uid",
        "eventCardUid: opponentMonster!.uid",
        "eventName: \"lifePointCostPaid\"",
        "eventName: \"destroyed\"",
        "eventReason: duelReason.destroy | duelReason.cost",
        "host.messages).not.toContain(\"invitation responder resolved\")",
      ],
    },
  ];
}

function realScriptAttackLockPersistentFixtureFiles(): string[] {
  return [
    "lua-real-script-fiendish-chain-persistent-disable.test.ts",
    "lua-real-script-gravity-bind-persistent-attack-lock.test.ts",
    "lua-real-script-level-limit-area-b-position-lock.test.ts",
    "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
    "lua-real-script-messenger-peace-maintenance-attack-lock.test.ts",
    "lua-real-script-phantom-knights-fog-blade-persistent-battle-target.test.ts",
    "lua-real-script-safe-zone-persistent-protection.test.ts",
    "lua-real-script-spellbinding-circle-persistent-lock.test.ts",
    "lua-real-script-swords-revealing-light-remain-lock.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptPersistentFixtures(): Array<{ file: string; kind: PersistentKind }> {
  return ([
    {
      file: "lua-real-script-dimension-sphinx-persistent-battle-damage.test.ts",
      kind: "persistentDamage",
    },
    {
      file: "lua-real-script-fiendish-chain-persistent-disable.test.ts",
      kind: "targetedDisableOrLock",
    },
    {
      file: "lua-real-script-dragons-bind-persistent-special-lock.test.ts",
      kind: "specialSummonLock",
    },
    {
      file: "lua-real-script-gravity-bind-persistent-attack-lock.test.ts",
      kind: "fieldAttackOrPositionLock",
    },
    {
      file: "lua-real-script-level-limit-area-b-position-lock.test.ts",
      kind: "fieldAttackOrPositionLock",
    },
    {
      file: "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
      kind: "persistentDamage",
    },
    {
      file: "lua-real-script-messenger-peace-maintenance-attack-lock.test.ts",
      kind: "fieldAttackOrPositionLock",
    },
    {
      file: "lua-real-script-miniaturize-persistent-damage-step-stat.test.ts",
      kind: "statModifier",
    },
    {
      file: "lua-real-script-moon-dance-ritual-persistent-overlay.test.ts",
      kind: "ritualOverlay",
    },
    {
      file: "lua-real-script-nightmare-wheel-persistent-damage.test.ts",
      kind: "persistentDamage",
    },
    {
      file: "lua-real-script-phantom-knights-fog-blade-persistent-battle-target.test.ts",
      kind: "targetedDisableOrLock",
    },
    {
      file: "lua-real-script-rare-metalmorph-persistent-chain-solving-negate.test.ts",
      kind: "chainSolvingNegate",
    },
    {
      file: "lua-real-script-safe-zone-persistent-protection.test.ts",
      kind: "protection",
    },
    {
      file: "lua-real-script-shadow-spell-goat-damage-calculation-persistent.test.ts",
      kind: "statModifier",
    },
    {
      file: "lua-real-script-shattered-axe-persistent-standby-atk.test.ts",
      kind: "statModifier",
    },
    {
      file: "lua-real-script-spellbinding-circle-persistent-lock.test.ts",
      kind: "targetedDisableOrLock",
    },
    {
      file: "lua-real-script-swords-revealing-light-remain-lock.test.ts",
      kind: "fieldAttackOrPositionLock",
    },
  ] satisfies Array<{ file: string; kind: PersistentKind }>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countPersistentKinds(fixtures: Array<{ kind: PersistentKind }>): Record<PersistentKind, number> {
  return fixtures.reduce<Record<PersistentKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      chainSolvingNegate: 0,
      fieldAttackOrPositionLock: 0,
      persistentDamage: 0,
      protection: 0,
      ritualOverlay: 0,
      specialSummonLock: 0,
      statModifier: 0,
      targetedDisableOrLock: 0,
    },
  );
}
