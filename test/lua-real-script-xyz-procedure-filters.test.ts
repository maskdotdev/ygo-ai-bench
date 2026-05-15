import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Xyz procedure filters", () => {
  it("restores official Xyz.AddProcedure FilterBoolFunction race filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const melffyMommyCode = "76833149";
    const warriorMaterialCodes = ["900000161", "900000162"];
    const beastMaterialCodes = ["900000163", "900000164"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === melffyMommyCode),
      ...warriorMaterialCodes.map((code, index) => ({
        code,
        name: `Warrior Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 2,
        race: 0x1,
      })),
      ...beastMaterialCodes.map((code, index) => ({
        code,
        name: `Beast Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 2,
        race: 0x4000,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 311, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [melffyMommyCode] }, 1: { main: [] } });
      startDuel(session);
      const xyz = session.state.cards.find((card) => card.code === melffyMommyCode && card.location === "extraDeck");
      expect(xyz).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(melffyMommyCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({
        xyzMaterialCount: 2,
        xyzMaterialRace: 0x4000,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
      return { restored, xyz };
    };

    const wrongRace = restoreWithMaterials(warriorMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongRace.restored, 0).some((action) => action.type === "xyzSummon" && action.uid === wrongRace.xyz!.uid)).toBe(false);

    const matchingRace = restoreWithMaterials(beastMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingRace.restored, 0).filter((action) => action.type === "xyzSummon" && action.uid === matchingRace.xyz!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingRace.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz Summon action");
    const summoned = applyLuaRestoreResponse(matchingRace.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingRace.restored.session.state.cards.find((card) => card.uid === matchingRace.xyz!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
    });
  });

  it("restores official Xyz.AddProcedure infinite material ranges for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const melffyMommyCode = "76833149";
    const beastMaterialCodes = ["900000199", "900000200", "900000201"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === melffyMommyCode),
      ...beastMaterialCodes.map((code, index) => ({
        code,
        name: `Extra Beast Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 2,
        race: 0x4000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 321, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: beastMaterialCodes, extra: [melffyMommyCode] }, 1: { main: [] } });
    startDuel(session);
    const xyz = session.state.cards.find((card) => card.code === melffyMommyCode && card.location === "extraDeck");
    expect(xyz).toBeDefined();
    for (const code of beastMaterialCodes) {
      const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(melffyMommyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({
      xyzMaterialCount: 2,
      xyzMaterialMax: 99,
      xyzMaterialRace: 0x4000,
    });
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid && candidate.materialUids.length === 3);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    if (!action || action.type !== "xyzSummon") throw new Error("Expected three-material Xyz Summon action");
    const summoned = applyLuaRestoreResponse(restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    const restoredXyz = restored.session.state.cards.find((card) => card.uid === xyz!.uid);
    const overlayUids = restoredXyz?.overlayUids;
    expect(restoredXyz).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
      overlayUids: expect.arrayContaining(beastMaterialCodes.map((code) => expect.stringContaining(code))),
    });
    if (!restoredXyz) throw new Error("Expected Xyz Summoned monster");
    expect(overlayUids).toHaveLength(3);
  });

  it("restores official Xyz.AddProcedure setcode filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gigantesDollCode = "7593748";
    const offSetMaterialCodes = ["900000165", "900000166"];
    const gimmickPuppetMaterialCodes = ["900000167", "900000168"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gigantesDollCode),
      ...offSetMaterialCodes.map((code, index) => ({
        code,
        name: `Off-Set Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 4,
        setcodes: [0x123],
      })),
      ...gimmickPuppetMaterialCodes.map((code, index) => ({
        code,
        name: `Gimmick Puppet Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 4,
        setcodes: [0x1083],
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 312, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [gigantesDollCode] }, 1: { main: [] } });
      startDuel(session);
      const xyz = session.state.cards.find((card) => card.code === gigantesDollCode && card.location === "extraDeck");
      expect(xyz).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(gigantesDollCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({
        xyzMaterialCount: 2,
        xyzMaterialSetcode: 0x1083,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expectRestoredLegalActions(restored, 0);
      return { restored, xyz };
    };

    const wrongSetcode = restoreWithMaterials(offSetMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongSetcode.restored, 0).some((action) => action.type === "xyzSummon" && action.uid === wrongSetcode.xyz!.uid)).toBe(false);

    const matchingSetcode = restoreWithMaterials(gimmickPuppetMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingSetcode.restored, 0).filter((action) => action.type === "xyzSummon" && action.uid === matchingSetcode.xyz!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingSetcode.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz Summon action");
    const summoned = applyLuaRestoreResponse(matchingSetcode.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingSetcode.restored.session.state.cards.find((card) => card.uid === matchingSetcode.xyz!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
    });
  });

  it("uses restored Xyz material type filters for Lua Duel.XyzSummon default material selection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const thunderEndCode = "698785";
    const effectMaterialCode = "900000202";
    const normalMaterialCodes = ["900000203", "900000204"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === thunderEndCode),
      { code: effectMaterialCode, name: "Level 8 Effect Material", kind: "monster" as const, typeFlags: 0x21, level: 8 },
      ...normalMaterialCodes.map((code, index) => ({
        code,
        name: `Level 8 Normal Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x11,
        level: 8,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 322, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [effectMaterialCode, ...normalMaterialCodes], extra: [thunderEndCode] }, 1: { main: [] } });
    startDuel(session);
    const xyz = session.state.cards.find((card) => card.code === thunderEndCode && card.location === "extraDeck");
    expect(xyz).toBeDefined();
    for (const code of [effectMaterialCode, ...normalMaterialCodes]) {
      const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(thunderEndCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({
      xyzMaterialCount: 2,
      xyzMaterialType: 0x10,
    });
    const result = host.loadScript(
      `
      local xyz=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${thunderEndCode}),0,LOCATION_EXTRA,0,1,1,nil):GetFirst()
      Debug.Message("default xyz type filter " .. Duel.XyzSummon(xyz))
      `,
      "thunder-end-default-xyz.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("default xyz type filter 1");
    const summoned = session.state.cards.find((card) => card.uid === xyz!.uid);
    const effectMaterial = session.state.cards.find((card) => card.code === effectMaterialCode);
    const normalMaterialUids = normalMaterialCodes.map((code) => session.state.cards.find((card) => card.code === code)?.uid);
    expect(summoned).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
    });
    expect(summoned?.overlayUids).toEqual(expect.arrayContaining(normalMaterialUids));
    expect(summoned?.overlayUids).toHaveLength(2);
    expect(summoned?.overlayUids).not.toContain(effectMaterial?.uid);
  });

  it("skips material locks for Lua Duel.XyzSummon default material selection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const thunderEndCode = "698785";
    const normalMaterialCodes = ["900000211", "900000212", "900000213"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === thunderEndCode),
      ...normalMaterialCodes.map((code, index) => ({
        code,
        name: `Lock-Aware Level 8 Normal Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x11,
        level: 8,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 325, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: normalMaterialCodes, extra: [thunderEndCode] }, 1: { main: [] } });
    startDuel(session);
    const xyz = session.state.cards.find((card) => card.code === thunderEndCode && card.location === "extraDeck");
    expect(xyz).toBeDefined();
    for (const code of normalMaterialCodes) {
      const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(thunderEndCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({
      xyzMaterialCount: 2,
      xyzMaterialType: 0x10,
    });
    const result = host.loadScript(
      `
      local blocked=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${normalMaterialCodes[0]}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local e=Effect.CreateEffect(blocked)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_CANNOT_BE_XYZ_MATERIAL)
      e:SetRange(LOCATION_MZONE)
      blocked:RegisterEffect(e)
      local xyz=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${thunderEndCode}),0,LOCATION_EXTRA,0,1,1,nil):GetFirst()
      Debug.Message("default xyz material lock " .. Duel.XyzSummon(xyz))
      `,
      "thunder-end-default-xyz-material-lock.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("default xyz material lock 1");
    const summoned = session.state.cards.find((card) => card.uid === xyz!.uid);
    const blockedMaterial = session.state.cards.find((card) => card.code === normalMaterialCodes[0]);
    const allowedMaterialUids = normalMaterialCodes.slice(1).map((code) => session.state.cards.find((card) => card.code === code)?.uid);
    expect(summoned).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
    });
    expect(summoned?.overlayUids).toEqual(expect.arrayContaining(allowedMaterialUids));
    expect(summoned?.overlayUids).toHaveLength(2);
    expect(summoned?.overlayUids).not.toContain(blockedMaterial?.uid);
    expect(blockedMaterial?.location).toBe("monsterZone");
  });

  it("restores official Xyz.AddProcedure rank filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const disasterCode = "67359907";
    const levelMaterialCodes = ["900000189", "900000190"];
    const rankMaterialCodes = ["900000191", "900000192"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === disasterCode),
      ...levelMaterialCodes.map((code, index) => ({
        code,
        name: `Level 7 Xyz Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 7,
      })),
      ...rankMaterialCodes.map((code, index) => ({
        code,
        name: `Rank 7 Xyz Material ${index + 1}`,
        kind: "extra" as const,
        typeFlags: 0x800001,
        level: 7,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 318, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [disasterCode] }, 1: { main: [] } });
      startDuel(session);
      const xyz = session.state.cards.find((card) => card.code === disasterCode && card.location === "extraDeck");
      expect(xyz).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(disasterCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({
        xyzMaterialCount: 2,
        xyzMaterialRank: 7,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expectRestoredLegalActions(restored, 0);
      return { restored, xyz };
    };

    const wrongRank = restoreWithMaterials(levelMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongRank.restored, 0).some((action) => action.type === "xyzSummon" && action.uid === wrongRank.xyz!.uid)).toBe(false);

    const matchingRank = restoreWithMaterials(rankMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingRank.restored, 0).filter((action) => action.type === "xyzSummon" && action.uid === matchingRank.xyz!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingRank.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz Summon action");
    const summoned = applyLuaRestoreResponse(matchingRank.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingRank.restored.session.state.cards.find((card) => card.uid === matchingRank.xyz!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
    });
  });
});
