import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const testRoot = path.join(root, "test");
const summonKeywords = ["summon", "fusion", "synchro", "xyz", "link", "ritual", "pendulum"];
const realScriptSummonFixtureCount = 145;
const summonProcedureFixtureCount = 20;
const typedSummonProcedureFixtureCount = 6;
const pendulumGrantFixtureCount = 3;
const pendulumHelperFixtureCount = 13;
const unionProcedureFixtureCount = 1;
const materialLockFixtureCount = 4;
const flipSummonSuccessTrapFixtureCount = 1;

describe("Lua real summon restore coverage", () => {
  it("requires real-script summon and procedure fixtures to assert Lua-aware complete restore with diagnostics", () => {
    const files = realScriptSummonFixtureFiles();
    expect(files).toHaveLength(realScriptSummonFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")');
      });

    expect(missing).toEqual([]);
  });

  it("requires real-script summon procedure fixtures to assert restored grouped legal actions", () => {
    const files = realScriptSummonProcedureFixtureFiles();
    expect(files).toHaveLength(summonProcedureFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires real-script typed summon procedure fixtures to prove restored summon type and Monster Zone placement", () => {
    const files = realScriptTypedSummonProcedureFixtureFiles();
    expect(files).toHaveLength(typedSummonProcedureFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !/location:\s*["']monsterZone["']/.test(text)
          || !/summonType:\s*["'](?:fusion|synchro|xyz|link|ritual)["']/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires real-script Pendulum grant fixtures to prove restored summon selection and consumption", () => {
    const files = realScriptPendulumGrantFixtureFiles();
    expect(files).toHaveLength(pendulumGrantFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("findPendulumSummon")
          || !text.includes("applyLuaRestoreAndAssert")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("pendulumSummonAvailable")
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !/location:\s*["']monsterZone["']/.test(text)
          || !/summonType:\s*["']pendulum["']/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires representative Pendulum helper fixtures to pin restored grant filters and count limits", () => {
    const files = realScriptPendulumHelperFixtureSnippets();
    expect(files).toHaveLength(pendulumHelperFixtureCount);

    const weak = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });

  it("requires representative Union procedure fixtures to pin restored equip and summon-back actions", () => {
    const files = realScriptUnionProcedureFixtureSnippets();
    expect(files).toHaveLength(unionProcedureFixtureCount);

    const weak = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });

  it("requires representative material-lock fixtures to pin restored legal-action suppression and clean Lua restore", () => {
    const files = realScriptMaterialLockFixtureSnippets();
    expect(files).toHaveLength(materialLockFixtureCount);

    const weak = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });

  it("requires representative Flip Summon success trap fixtures to pin restored chain-response activations", () => {
    const files = realScriptFlipSummonSuccessTrapFixtureSnippets();
    expect(files).toHaveLength(flipSummonSuccessTrapFixtureCount);

    const weak = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });
});

function realScriptSummonFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.startsWith("lua-real-script-") && file.endsWith(".test.ts"))
    .filter((file) => summonKeywords.some((keyword) => file.includes(keyword)))
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptFlipSummonSuccessTrapFixtureSnippets(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-house-adhesive-tape-flip-summon.test.ts",
      required: [
        'eventName: "flipSummoned"',
        'effectId).toContain("-1101"',
        'windowKind).toBe("chainResponse")',
        'type === "activateEffect"',
      ],
    },
  ];
}

function realScriptSummonProcedureFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-real-script-(?:link|xyz|synchro)-procedure-filters\.test\.ts$/.test(file) || [
      "lua-real-script-chronomaly-moai-special-summon-procedure.test.ts",
      "lua-real-script-depth-shark-no-tribute-summon-procedure.test.ts",
      "lua-real-script-desert-twister-special-summon-procedure.test.ts",
      "lua-real-script-emissary-select-tribute-summon-procedure.test.ts",
      "lua-real-script-geira-guile-special-summon-procedure.test.ts",
      "lua-real-script-gigarays-gandora-special-summon-procedure.test.ts",
      "lua-real-script-guardian-eatos-special-summon-procedure.test.ts",
      "lua-real-script-leo-wizard-opponent-summon-procedure.test.ts",
      "lua-real-script-megarock-dragon-special-summon-procedure.test.ts",
      "lua-real-script-megalith-bethor-ritual-procedure.test.ts",
      "lua-real-script-mitsurugi-mirror-grave-ritual.test.ts",
      "lua-real-script-morganite-field-summon-procedure.test.ts",
      "lua-real-script-palm-ryzeal-special-summon-procedure.test.ts",
      "lua-real-script-pankratops-special-summon-procedure.test.ts",
      "lua-real-script-pendulum-procedure-actions.test.ts",
      "lua-real-script-polymerization-fusion-summon.test.ts",
      "lua-real-script-prayers-ritual-matfilter.test.ts",
    ].includes(file))
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptTypedSummonProcedureFixtureFiles(): string[] {
  return [
    "lua-real-script-link-procedure-filters.test.ts",
    "lua-real-script-megalith-bethor-ritual-procedure.test.ts",
    "lua-real-script-mitsurugi-mirror-grave-ritual.test.ts",
    "lua-real-script-polymerization-fusion-summon.test.ts",
    "lua-real-script-synchro-procedure-filters.test.ts",
    "lua-real-script-xyz-procedure-filters.test.ts",
  ].map((file) => path.join("test", file));
}

function realScriptPendulumGrantFixtureFiles(): string[] {
  return [
    "lua-real-script-extra-pendulum-opponent-scale-grant.test.ts",
    "lua-real-script-harmonic-oscillation-pendulum-grant.test.ts",
    "lua-real-script-soul-pendulum-extra-summon.test.ts",
  ].map((file) => path.join("test", file));
}

function realScriptPendulumHelperFixtureSnippets(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-abyss-actor-twinkle-pendulum-setcode-lock.test.ts",
      required: [
        `luaTargetDescriptor: \`target:pendulum-summon-not-setcode:\${setAbyssActor}\``,
        "twinkle abyss actor pendulum special 1",
        "twinkle generic pendulum special 0",
        "twinkle regular special 1",
        "getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)",
      ],
    },
    {
      file: "lua-real-script-couplet-pendulum-light-lock.test.ts",
      required: [
        `luaTargetDescriptor: \`target:pendulum-summon-not-attribute:\${attributeLight}\``,
        "couplet light pendulum special 1",
        "couplet dark pendulum special 0",
        "couplet dark regular special 1",
        "getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)",
      ],
    },
    {
      file: "lua-real-script-odd-eyes-phantasma-pendulum-summon-lock.test.ts",
      required: [
        `luaTargetDescriptor: \`target:special-summon-type-is:\${luaSummonTypePendulum}\``,
        "phantasma pendulum special 0",
        "phantasma regular special 1",
        "getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)",
      ],
    },
    {
      file: "lua-real-script-pendulum-procedure-actions.test.ts",
      required: [
        "findPendulumActivation",
        "const restoredPendulumWindow = restoreDuelWithLuaScripts",
        "const pendulumSummon = getLuaRestoreLegalActions(restoredPendulumWindow, 0).find",
        'summonType: "pendulum"',
        "expect(restoredPendulumWindow.session.state.players[0].pendulumSummonAvailable).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-soul-pendulum-extra-summon.test.ts",
      required: [
        "session.state.players[0].pendulumSummonAvailable = false",
        "expect(findPendulumSummon(restored.session, getLuaRestoreLegalActions(restored, 0), candidate!.uid)).toBeUndefined()",
        "applyLuaRestoreAndAssert(restoredAfterGrant, { ...pendulumSummon!, summonUids: [candidate!.uid] })",
        'summonType: "pendulum"',
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-extra-pendulum-location-grant.test.ts",
      required: [
        "expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), extraCandidate!.uid)).toBeUndefined()",
        "expect(restoredAfterGrant.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: \"player\", ownerId: \"0\", code: Number(extraPendulumCode) })]))",
        "expect(findExtraPendulumActivation(restoredAfterGrant.session, getLuaRestoreLegalActions(restoredAfterGrant, 0), secondExtraPendulum!.uid)).toBeUndefined()",
        "expect(pendulumSummon!.summonUids).not.toContain(handCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-extra-pendulum-opponent-scale-grant.test.ts",
      required: [
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([",
        "expect.objectContaining({ locationMask: 0x40, scaleAlternatives: [expect.objectContaining({ locationMask: 0x40, scalePlayer: 1 })] })",
        "expect(pendulumSummon!.summonUids).not.toContain(handCandidate!.uid)",
        'summonType: "pendulum"',
      ],
    },
    {
      file: "lua-real-script-harmonic-oscillation-pendulum-grant.test.ts",
      required: [
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ locationMask: 0x40, scalePlayer: 1 })])",
        "expect(pendulumSummon!.summonUids).toContain(extraCandidate!.uid)",
        "expect(pendulumSummon!.summonUids).not.toContain(handCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-zefraath-special-summon-pendulum-grant.test.ts",
      required: [
        "expect(session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setZefra })])",
        "expect(restored.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: \"player\", ownerId: \"0\", code: Number(zefraathCode) })]))",
        "expect(pendulumSummon!.summonUids).not.toContain(rejectedCandidate!.uid)",
        "expect(restored.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-moissa-knight-hand-pendulum-grant.test.ts",
      required: [
        "expect(pendulumSummon!.summonUids).toContain(handCandidate!.uid)",
        "expect(pendulumSummon!.summonUids).not.toContain(extraCandidate!.uid)",
        "applyLuaRestoreAndAssert(restoredAfterGrant, { ...pendulumSummon!, summonUids: [handCandidate!.uid] })",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-ddd-zeus-ragnarok-filtered-pendulum-grant.test.ts",
      required: [
        "expect(restoredAfterGrant.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: \"player\", ownerId: \"0\", code: Number(zeusCode) })]))",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setDD })])",
        "expect(pendulumSummon!.summonUids).not.toContain(rejectedCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-solfachord-happiness-filtered-pendulum-grant.test.ts",
      required: [
        "expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), allowedCandidate!.uid)).toBeUndefined()",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setSolfachord })])",
        "expect(pendulumSummon!.summonUids).not.toContain(rejectedCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-blue-eyes-spirit-pendulum-count-limit.test.ts",
      required: [
        "expect.objectContaining({ maxSummons: 4, summonUids: [first.uid, second.uid] })",
        "expect.objectContaining({ maxSummons: 1, summonUids: [first.uid, second.uid] })",
        "expect(applyResponse(session, { ...restrictedAction, summonUids: [first.uid, second.uid] }).ok).toBe(false)",
        'Debug.Message("spirit pendulum can " .. tostring(Duel.IsPlayerCanPendulumSummon(0)))',
        'Debug.Message("spirit pendulum summoned " .. Duel.PendulumSummon(0))',
      ],
    },
  ].map(({ file, required }) => ({ file: path.join("test", file), required }));
}

function realScriptUnionProcedureFixtureSnippets(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      required: [
        "getLuaRestoreLegalActionGroups(restoredEquipWindow, 0).flatMap((group) => group.actions)",
        "findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), unionDriver!.uid, 1068)",
        'location: "spellTrapZone", equippedToUid: target!.uid',
        "findEffectAction(restoredSummonWindow.session, getLuaRestoreLegalActions(restoredSummonWindow, 0), unionDriver!.uid, 2)",
        'location: "monsterZone"',
        "previousEquippedToUid: target!.uid",
        "findEffectActionByCategory(restoredDriverDeckEquipWindow.session, getLuaRestoreLegalActions(restoredDriverDeckEquipWindow, 0), unionDriver!.uid, 0x40000)",
        "findEffectActionByCategory(restoredEquippedState.session, getLuaRestoreLegalActions(restoredEquippedState, 0), unionPilot!.uid, 0x40200)",
        '{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }',
        'eventName: "specialSummoned", eventCode: 1102',
      ],
    },
  ].map(({ file, required }) => ({ file: path.join("test", file), required }));
}

function realScriptMaterialLockFixtureSnippets(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-mysterion-fusion-material-lock.test.ts",
      required: [
        "code: 235",
        'action.type === "fusionSummon"',
        "cannot be used as fusion material",
      ],
    },
    {
      file: "lua-real-script-doggy-diver-xyz-material-lock.test.ts",
      required: [
        "code: 238",
        'action.type === "xyzSummon"',
        "cannot be used as Xyz material",
      ],
    },
    {
      file: "lua-real-script-anger-knuckle-link-material-lock.test.ts",
      required: [
        "code: 239",
        'action.type === "linkSummon"',
        "cannot be used as Link material",
      ],
    },
    {
      file: "lua-real-script-fallin-cheatah-generic-material-lock.test.ts",
      required: [
        "code: 248",
        'action.type === "fusionSummon"',
        'action.type === "synchroSummon"',
        'action.type === "xyzSummon"',
        'action.type === "linkSummon"',
        "ritualSummonDuelCard",
      ],
    },
  ].map(({ file, required }) => ({ file: path.join("test", file), required }));
}
