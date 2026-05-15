import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script summon procedures", () => {
  it("special summons Diabellstar by procedure and resolves its set trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const diabellstarCode = "72270339";
    const fodderCode = "73642296";
    const wantedCode = "80845034";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [diabellstarCode, fodderCode, wantedCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 291, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [diabellstarCode, fodderCode, wantedCode] }, 1: { main: [] } });
    startDuel(session);

    const diabellstar = session.state.cards.find((card) => card.code === diabellstarCode && card.location === "deck");
    const fodder = session.state.cards.find((card) => card.code === fodderCode && card.location === "deck");
    const wanted = session.state.cards.find((card) => card.code === wantedCode && card.location === "deck");
    expect(diabellstar).toBeDefined();
    expect(fodder).toBeDefined();
    expect(wanted).toBeDefined();
    moveDuelCard(session.state, diabellstar!.uid, "hand", 0);
    moveDuelCard(session.state, fodder!.uid, "hand", 0);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(diabellstarCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === diabellstar!.uid);
    expect(procedure).toBeDefined();
    const summoned = applyLuaRestoreResponse(restored, procedure!);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === diabellstar!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === fodder!.uid)).toMatchObject({ location: "graveyard" });

    const setTrigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === diabellstar!.uid);
    expect(setTrigger).toBeDefined();
    const set = applyLuaRestoreResponse(restored, setTrigger!);
    expect(set.ok, set.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === wanted!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: false });
  });

  it("restores official Xyz.AddProcedure material counts for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const triEdgeCode = "68836428";
    const materialCodes = ["900000001", "900000002", "900000003"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === triEdgeCode),
      ...materialCodes.map((code, index) => ({
        code,
        name: `Level 3 Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 3,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 292, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: materialCodes, extra: [triEdgeCode] }, 1: { main: [] } });
    startDuel(session);

    const triEdge = session.state.cards.find((card) => card.code === triEdgeCode && card.location === "extraDeck");
    const materials = materialCodes.map((code) => session.state.cards.find((card) => card.code === code && card.location === "deck"));
    expect(triEdge).toBeDefined();
    expect(materials.every(Boolean)).toBe(true);
    for (const material of materials) moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(triEdgeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.cards.find((card) => card.uid === triEdge!.uid)?.data.xyzMaterialCount).toBe(3);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const actions = getLuaRestoreLegalActions(restored, 0).filter((action) => action.type === "xyzSummon" && action.uid === triEdge!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz Summon action");
    expect(action.materialUids).toHaveLength(3);
    const summoned = applyLuaRestoreResponse(restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === triEdge!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
      overlayUids: expect.arrayContaining(action.materialUids),
    });
  });

  it("restores official Xyz.AddProcedure race filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const claivesolishCode = "97453744";
    const dragonMaterialCodes = ["900000031", "900000032"];
    const warriorMaterialCodes = ["900000033", "900000034"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === claivesolishCode),
      ...dragonMaterialCodes.map((code, index) => ({
        code,
        name: `Dragon Level 4 Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 4,
        race: 0x2000,
      })),
      ...warriorMaterialCodes.map((code, index) => ({
        code,
        name: `Warrior Level 4 Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 4,
        race: 0x1,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 295, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [claivesolishCode] }, 1: { main: [] } });
      startDuel(session);
      const xyz = session.state.cards.find((card) => card.code === claivesolishCode && card.location === "extraDeck");
      expect(xyz).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(claivesolishCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({ xyzMaterialCount: 2, xyzMaterialRace: 0x1 });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, xyz };
    };

    const wrongRace = restoreWithMaterials(dragonMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongRace.restored, 0).some((action) => action.type === "xyzSummon" && action.uid === wrongRace.xyz!.uid)).toBe(false);

    const matchingRace = restoreWithMaterials(warriorMaterialCodes);
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

  it("restores official Xyz.AddProcedure attribute filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const evilswarmNightmareCode = "359563";
    const lightMaterialCodes = ["900000051", "900000052"];
    const darkMaterialCodes = ["900000053", "900000054"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === evilswarmNightmareCode),
      ...lightMaterialCodes.map((code, index) => ({
        code,
        name: `Light Level 4 Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 4,
        attribute: 0x10,
      })),
      ...darkMaterialCodes.map((code, index) => ({
        code,
        name: `Dark Level 4 Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 4,
        attribute: 0x20,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 300, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [evilswarmNightmareCode] }, 1: { main: [] } });
      startDuel(session);
      const xyz = session.state.cards.find((card) => card.code === evilswarmNightmareCode && card.location === "extraDeck");
      expect(xyz).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(evilswarmNightmareCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({ xyzMaterialCount: 2, xyzMaterialAttribute: 0x20 });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, xyz };
    };

    const wrongAttribute = restoreWithMaterials(lightMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongAttribute.restored, 0).some((action) => action.type === "xyzSummon" && action.uid === wrongAttribute.xyz!.uid)).toBe(false);

    const matchingAttribute = restoreWithMaterials(darkMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingAttribute.restored, 0).filter((action) => action.type === "xyzSummon" && action.uid === matchingAttribute.xyz!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingAttribute.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz Summon action");
    const summoned = applyLuaRestoreResponse(matchingAttribute.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingAttribute.restored.session.state.cards.find((card) => card.uid === matchingAttribute.xyz!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
    });
  });

  it("restores official Xyz.AddProcedure type filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const thunderEndDragonCode = "698785";
    const effectMaterialCodes = ["900000081", "900000082"];
    const normalMaterialCodes = ["900000083", "900000084"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === thunderEndDragonCode),
      ...effectMaterialCodes.map((code, index) => ({
        code,
        name: `Effect Level 8 Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x21,
        level: 8,
      })),
      ...normalMaterialCodes.map((code, index) => ({
        code,
        name: `Normal Level 8 Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x11,
        level: 8,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 303, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [thunderEndDragonCode] }, 1: { main: [] } });
      startDuel(session);
      const xyz = session.state.cards.find((card) => card.code === thunderEndDragonCode && card.location === "extraDeck");
      expect(xyz).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(thunderEndDragonCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.data).toMatchObject({ xyzMaterialCount: 2, xyzMaterialType: 0x10 });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, xyz };
    };

    const wrongType = restoreWithMaterials(effectMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongType.restored, 0).some((action) => action.type === "xyzSummon" && action.uid === wrongType.xyz!.uid)).toBe(false);

    const matchingType = restoreWithMaterials(normalMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingType.restored, 0).filter((action) => action.type === "xyzSummon" && action.uid === matchingType.xyz!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingType.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz Summon action");
    const summoned = applyLuaRestoreResponse(matchingType.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingType.restored.session.state.cards.find((card) => card.uid === matchingType.xyz!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
    });
  });

  it("restores official Link.AddProcedure material count ranges for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const babaBarberCode = "67073561";
    const link2MaterialCode = "900000011";
    const normalMaterialCodes = ["900000012", "900000013"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === babaBarberCode),
      { code: link2MaterialCode, name: "Synthetic Link-2 Material", kind: "extra" as const, typeFlags: 0x4000001, level: 2 },
      ...normalMaterialCodes.map((code, index) => ({
        code,
        name: `Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 293, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [babaBarberCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === babaBarberCode && card.location === "extraDeck");
      expect(link).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(babaBarberCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({ linkMaterialMin: 2, linkMaterialMax: 2 });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, link };
    };

    const singleLinkMaterial = restoreWithMaterials([link2MaterialCode]);
    expect(getLuaRestoreLegalActions(singleLinkMaterial.restored, 0).some((action) => action.type === "linkSummon" && action.uid === singleLinkMaterial.link!.uid)).toBe(false);

    const twoMaterials = restoreWithMaterials(normalMaterialCodes);
    const actions = getLuaRestoreLegalActions(twoMaterials.restored, 0).filter((action) => action.type === "linkSummon" && action.uid === twoMaterials.link!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(twoMaterials.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link Summon action");
    expect(action.materialUids).toHaveLength(2);
    const summoned = applyLuaRestoreResponse(twoMaterials.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(twoMaterials.restored.session.state.cards.find((card) => card.uid === twoMaterials.link!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
    });
  });

  it("restores official Link.AddProcedure type filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const linkSpiderCode = "98978921";
    const effectMaterialCode = "900000041";
    const normalMaterialCode = "900000042";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === linkSpiderCode),
      { code: effectMaterialCode, name: "Effect Link Material", kind: "monster" as const, typeFlags: 0x21, level: 4 },
      { code: normalMaterialCode, name: "Normal Link Material", kind: "monster" as const, typeFlags: 0x11, level: 4 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterial = (code: string) => {
      const session = createDuel({ seed: 296, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [code], extra: [linkSpiderCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === linkSpiderCode && card.location === "extraDeck");
      const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
      expect(link).toBeDefined();
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(linkSpiderCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({ linkMaterialMin: 1, linkMaterialMax: 1, linkMaterialType: 0x10 });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, link };
    };

    const wrongType = restoreWithMaterial(effectMaterialCode);
    expect(getLuaRestoreLegalActions(wrongType.restored, 0).some((action) => action.type === "linkSummon" && action.uid === wrongType.link!.uid)).toBe(false);

    const matchingType = restoreWithMaterial(normalMaterialCode);
    const actions = getLuaRestoreLegalActions(matchingType.restored, 0).filter((action) => action.type === "linkSummon" && action.uid === matchingType.link!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingType.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link Summon action");
    const summoned = applyLuaRestoreResponse(matchingType.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingType.restored.session.state.cards.find((card) => card.uid === matchingType.link!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
    });
  });

  it("restores official Link.AddProcedure race filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const clockSpartoiCode = "4478086";
    const warriorMaterialCodes = ["900000061", "900000062"];
    const cyberseMaterialCodes = ["900000063", "900000064"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === clockSpartoiCode),
      ...warriorMaterialCodes.map((code, index) => ({
        code,
        name: `Warrior Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        race: 0x1,
      })),
      ...cyberseMaterialCodes.map((code, index) => ({
        code,
        name: `Cyberse Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        race: 0x1000000,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 301, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [clockSpartoiCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === clockSpartoiCode && card.location === "extraDeck");
      expect(link).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(clockSpartoiCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({ linkMaterialMin: 2, linkMaterialMax: 2, linkMaterialRace: 0x1000000 });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, link };
    };

    const wrongRace = restoreWithMaterials(warriorMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongRace.restored, 0).some((action) => action.type === "linkSummon" && action.uid === wrongRace.link!.uid)).toBe(false);

    const matchingRace = restoreWithMaterials(cyberseMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingRace.restored, 0).filter((action) => action.type === "linkSummon" && action.uid === matchingRace.link!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingRace.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link Summon action");
    const summoned = applyLuaRestoreResponse(matchingRace.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingRace.restored.session.state.cards.find((card) => card.uid === matchingRace.link!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
    });
  });

  it("restores official Link.AddProcedure attribute filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const crystalHeartCode = "67712104";
    const fireMaterialCodes = ["900000071", "900000072"];
    const waterMaterialCodes = ["900000073", "900000074"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === crystalHeartCode),
      ...fireMaterialCodes.map((code, index) => ({
        code,
        name: `Fire Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        attribute: 0x4,
      })),
      ...waterMaterialCodes.map((code, index) => ({
        code,
        name: `Water Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        attribute: 0x2,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 302, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [crystalHeartCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === crystalHeartCode && card.location === "extraDeck");
      expect(link).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(crystalHeartCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({ linkMaterialMin: 2, linkMaterialMax: 2, linkMaterialAttribute: 0x2 });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, link };
    };

    const wrongAttribute = restoreWithMaterials(fireMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongAttribute.restored, 0).some((action) => action.type === "linkSummon" && action.uid === wrongAttribute.link!.uid)).toBe(false);

    const matchingAttribute = restoreWithMaterials(waterMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingAttribute.restored, 0).filter((action) => action.type === "linkSummon" && action.uid === matchingAttribute.link!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingAttribute.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link Summon action");
    const summoned = applyLuaRestoreResponse(matchingAttribute.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingAttribute.restored.session.state.cards.find((card) => card.uid === matchingAttribute.link!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
    });
  });

  it("restores official Synchro.AddProcedure tuner and non-tuner count ranges for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const boardeflyCode = "3966653";
    const shortMaterialCodes = ["900000021", "900000022"];
    const legalMaterialCodes = ["900000023", "900000024", "900000025"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === boardeflyCode),
      { code: shortMaterialCodes[0]!, name: "Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3 },
      { code: shortMaterialCodes[1]!, name: "Level 3 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 3 },
      { code: legalMaterialCodes[0]!, name: "Level 2 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 2 },
      { code: legalMaterialCodes[1]!, name: "First Level 2 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 2 },
      { code: legalMaterialCodes[2]!, name: "Second Level 2 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 2 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 294, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [boardeflyCode] }, 1: { main: [] } });
      startDuel(session);
      const synchro = session.state.cards.find((card) => card.code === boardeflyCode && card.location === "extraDeck");
      expect(synchro).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(boardeflyCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
        synchroTunerMin: 1,
        synchroTunerMax: 1,
        synchroNonTunerMin: 2,
        synchroNonTunerMax: 2,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, synchro };
    };

    const tooFewMaterials = restoreWithMaterials(shortMaterialCodes);
    expect(getLuaRestoreLegalActions(tooFewMaterials.restored, 0).some((action) => action.type === "synchroSummon" && action.uid === tooFewMaterials.synchro!.uid)).toBe(false);

    const exactCounts = restoreWithMaterials(legalMaterialCodes);
    const actions = getLuaRestoreLegalActions(exactCounts.restored, 0).filter((action) => action.type === "synchroSummon" && action.uid === exactCounts.synchro!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(exactCounts.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected Synchro Summon action");
    expect(action.materialUids).toHaveLength(3);
    const summoned = applyLuaRestoreResponse(exactCounts.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(exactCounts.restored.session.state.cards.find((card) => card.uid === exactCounts.synchro!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
    });
  });

  it("restores official Synchro.AddProcedure tuner attribute filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const vylonEpsilonCode = "75779210";
    const darkMaterialCodes = ["900000091", "900000092"];
    const lightMaterialCodes = ["900000093", "900000094"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === vylonEpsilonCode),
      { code: darkMaterialCodes[0]!, name: "Dark Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3, attribute: 0x20 },
      { code: darkMaterialCodes[1]!, name: "Level 5 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 5 },
      { code: lightMaterialCodes[0]!, name: "Light Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3, attribute: 0x10 },
      { code: lightMaterialCodes[1]!, name: "Second Level 5 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 5 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 304, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [vylonEpsilonCode] }, 1: { main: [] } });
      startDuel(session);
      const synchro = session.state.cards.find((card) => card.code === vylonEpsilonCode && card.location === "extraDeck");
      expect(synchro).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(vylonEpsilonCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
        synchroTunerMin: 1,
        synchroTunerMax: 1,
        synchroTunerAttribute: 0x10,
        synchroNonTunerMin: 1,
        synchroNonTunerMax: 99,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, synchro };
    };

    const wrongTuner = restoreWithMaterials(darkMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongTuner.restored, 0).some((action) => action.type === "synchroSummon" && action.uid === wrongTuner.synchro!.uid)).toBe(false);

    const matchingTuner = restoreWithMaterials(lightMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingTuner.restored, 0).filter((action) => action.type === "synchroSummon" && action.uid === matchingTuner.synchro!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingTuner.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected Synchro Summon action");
    const summoned = applyLuaRestoreResponse(matchingTuner.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingTuner.restored.session.state.cards.find((card) => card.uid === matchingTuner.synchro!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
    });
  });

  it("restores official Synchro.AddProcedure tuner race filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gigaSpinosavateCode = "58672736";
    const warriorMaterialCodes = ["900000101", "900000102"];
    const dinosaurMaterialCodes = ["900000103", "900000104"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gigaSpinosavateCode),
      { code: warriorMaterialCodes[0]!, name: "Warrior Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3, race: 0x1 },
      { code: warriorMaterialCodes[1]!, name: "Level 5 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 5 },
      { code: dinosaurMaterialCodes[0]!, name: "Dinosaur Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3, race: 0x10000 },
      { code: dinosaurMaterialCodes[1]!, name: "Second Level 5 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 5 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 305, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [gigaSpinosavateCode] }, 1: { main: [] } });
      startDuel(session);
      const synchro = session.state.cards.find((card) => card.code === gigaSpinosavateCode && card.location === "extraDeck");
      expect(synchro).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(gigaSpinosavateCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
        synchroTunerMin: 1,
        synchroTunerMax: 1,
        synchroTunerRace: 0x10000,
        synchroNonTunerMin: 1,
        synchroNonTunerMax: 99,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, synchro };
    };

    const wrongTuner = restoreWithMaterials(warriorMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongTuner.restored, 0).some((action) => action.type === "synchroSummon" && action.uid === wrongTuner.synchro!.uid)).toBe(false);

    const matchingTuner = restoreWithMaterials(dinosaurMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingTuner.restored, 0).filter((action) => action.type === "synchroSummon" && action.uid === matchingTuner.synchro!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingTuner.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected Synchro Summon action");
    const summoned = applyLuaRestoreResponse(matchingTuner.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingTuner.restored.session.state.cards.find((card) => card.uid === matchingTuner.synchro!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
    });
  });

  it("restores official Synchro.AddProcedure tuner type filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const assaultDragonCode = "73218989";
    const effectMaterialCodes = ["900000111", "900000112"];
    const synchroMaterialCodes = ["900000113", "900000114"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === assaultDragonCode),
      { code: effectMaterialCodes[0]!, name: "Effect Level 5 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 5 },
      { code: effectMaterialCodes[1]!, name: "Level 5 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 5 },
      { code: synchroMaterialCodes[0]!, name: "Synchro Level 5 Tuner", kind: "extra" as const, typeFlags: 0x3001, level: 5 },
      { code: synchroMaterialCodes[1]!, name: "Second Level 5 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 5 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 306, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [assaultDragonCode] }, 1: { main: [] } });
      startDuel(session);
      const synchro = session.state.cards.find((card) => card.code === assaultDragonCode && card.location === "extraDeck");
      expect(synchro).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(assaultDragonCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
        synchroTunerMin: 1,
        synchroTunerMax: 1,
        synchroTunerType: 0x2000,
        synchroNonTunerMin: 1,
        synchroNonTunerMax: 99,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, synchro };
    };

    const wrongTuner = restoreWithMaterials(effectMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongTuner.restored, 0).some((action) => action.type === "synchroSummon" && action.uid === wrongTuner.synchro!.uid)).toBe(false);

    const matchingTuner = restoreWithMaterials(synchroMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingTuner.restored, 0).filter((action) => action.type === "synchroSummon" && action.uid === matchingTuner.synchro!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingTuner.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected Synchro Summon action");
    const summoned = applyLuaRestoreResponse(matchingTuner.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingTuner.restored.session.state.cards.find((card) => card.uid === matchingTuner.synchro!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
    });
  });

  it("restores official Synchro.AddProcedure non-tuner attribute filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const naturiaBarkionCode = "2956282";
    const fireMaterialCodes = ["900000121", "900000122"];
    const earthMaterialCodes = ["900000123", "900000124"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === naturiaBarkionCode),
      { code: fireMaterialCodes[0]!, name: "Earth Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3, attribute: 0x1 },
      { code: fireMaterialCodes[1]!, name: "Fire Level 3 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 3, attribute: 0x4 },
      { code: earthMaterialCodes[0]!, name: "Second Earth Level 3 Tuner", kind: "monster" as const, typeFlags: 0x1001, level: 3, attribute: 0x1 },
      { code: earthMaterialCodes[1]!, name: "Earth Level 3 Non-Tuner", kind: "monster" as const, typeFlags: 0x1, level: 3, attribute: 0x1 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 307, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [naturiaBarkionCode] }, 1: { main: [] } });
      startDuel(session);
      const synchro = session.state.cards.find((card) => card.code === naturiaBarkionCode && card.location === "extraDeck");
      expect(synchro).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(naturiaBarkionCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.data).toMatchObject({
        synchroTunerMin: 1,
        synchroTunerMax: 1,
        synchroTunerAttribute: 0x1,
        synchroNonTunerMin: 1,
        synchroNonTunerMax: 99,
        synchroNonTunerAttribute: 0x1,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      return { restored, synchro };
    };

    const wrongNonTuner = restoreWithMaterials(fireMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongNonTuner.restored, 0).some((action) => action.type === "synchroSummon" && action.uid === wrongNonTuner.synchro!.uid)).toBe(false);

    const matchingNonTuner = restoreWithMaterials(earthMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingNonTuner.restored, 0).filter((action) => action.type === "synchroSummon" && action.uid === matchingNonTuner.synchro!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingNonTuner.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected Synchro Summon action");
    const summoned = applyLuaRestoreResponse(matchingNonTuner.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingNonTuner.restored.session.state.cards.find((card) => card.uid === matchingNonTuner.synchro!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "synchro",
    });
  });

  it("restores Spirit procedure End Phase return after a real Normal Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const yataCode = "3078576";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === yataCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 297, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [yataCode] }, 1: { main: [] } });
    startDuel(session);

    const yata = session.state.cards.find((card) => card.code === yataCode && card.location === "deck");
    expect(yata).toBeDefined();
    moveDuelCard(session.state, yata!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(yataCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === yata!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    expect(session.state.cards.find((card) => card.uid === yata!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });

    for (const phase of ["battle", "main2", "end"] as const) {
      const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
      expect(action, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
      applyAndAssert(session, action!);
    }
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        eventCode: 0x1200,
        eventName: "phaseEnd",
        effectId: expect.stringMatching(/^lua-\d+-4608$/),
        sourceUid: yata!.uid,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const returnTrigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === yata!.uid);
    expect(returnTrigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, returnTrigger!);
    expect(activated.ok, activated.error).toBe(true);
    while (restored.session.state.chain.length > 0) {
      const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
      const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
      const passed = applyLuaRestoreResponse(restored, pass!);
      expect(passed.ok, passed.error).toBe(true);
    }
    expect(restored.session.state.cards.find((card) => card.uid === yata!.uid)).toMatchObject({ location: "hand", controller: 0 });
  });

  it("restores real cannot-be-Special-Summoned conditions for Spirit monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const yataCode = "3078576";
    const monsterRebornCode = "83764718";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [yataCode, monsterRebornCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 298, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [yataCode, monsterRebornCode] }, 1: { main: [] } });
    startDuel(session);

    const yata = session.state.cards.find((card) => card.code === yataCode && card.location === "deck");
    const monsterReborn = session.state.cards.find((card) => card.code === monsterRebornCode && card.location === "deck");
    expect(yata).toBeDefined();
    expect(monsterReborn).toBeDefined();
    moveDuelCard(session.state, yata!.uid, "graveyard", 0);
    moveDuelCard(session.state, monsterReborn!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(yataCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(monsterRebornCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    expect(hasActivateEffect(getDuelLegalActions(session, 0), monsterReborn!.uid)).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 0), monsterReborn!.uid)).toBe(false);
  });

  it("restores real Gemini second Normal Summon triggers", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const evequeCode = "16146511";
    const geminiTargetCode = "3918345";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [evequeCode, geminiTargetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 299, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [evequeCode, geminiTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const eveque = session.state.cards.find((card) => card.code === evequeCode && card.location === "deck");
    const target = session.state.cards.find((card) => card.code === geminiTargetCode && card.location === "deck");
    expect(eveque).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, eveque!.uid, "monsterZone", 0);
    eveque!.faceUp = true;
    eveque!.position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(evequeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const geminiSummon = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "normalSummon" && action.uid === eveque!.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const summoned = applyLuaRestoreResponse(restored, geminiSummon!);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === eveque!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "normal",
      summonTypeCode: 0x12000000,
    });

    const triggerRestored = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expect(triggerRestored.restoreComplete, triggerRestored.incompleteReasons.join("; ")).toBe(true);
    expect(triggerRestored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(triggerRestored, 0)).toEqual(getGroupedDuelLegalActions(triggerRestored.session, 0));
    expect(getLuaRestoreLegalActions(triggerRestored, 0)).toEqual(getDuelLegalActions(triggerRestored.session, 0));
    const trigger = getLuaRestoreLegalActions(triggerRestored, 0).find((action) => action.type === "activateTrigger" && action.uid === eveque!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(triggerRestored, 0), null, 2)).toBeDefined();
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(response.state.waitingFor === undefined ? [] : getDuelLegalActions(session, response.state.waitingFor));
  return response;
}

function hasActivateEffect(actions: ReturnType<typeof getDuelLegalActions>, uid: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.uid === uid);
}
