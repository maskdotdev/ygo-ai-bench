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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Link procedure filters", () => {
  it("restores official Link.AddProcedure ORed race filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const seleneSnapperCode = "75352507";
    const warriorMaterialCodes = ["900000151", "900000152", "900000153"];
    const plantMaterialCodes = ["900000154", "900000155", "900000156"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === seleneSnapperCode),
      ...warriorMaterialCodes.map((code, index) => ({
        code,
        name: `Warrior Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        race: 0x1,
      })),
      ...plantMaterialCodes.map((code, index) => ({
        code,
        name: `Plant Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        race: 0x400,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 310, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [seleneSnapperCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === seleneSnapperCode && card.location === "extraDeck");
      expect(link).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(seleneSnapperCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({
        linkMaterialMin: 2,
        linkMaterialRace: 0x80c00,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(restored.missingChainLimitRegistryKeys).toEqual([]);
      expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
      expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
      return { restored, link };
    };

    const wrongRace = restoreWithMaterials(warriorMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongRace.restored, 0).some((action) => action.type === "linkSummon" && action.uid === wrongRace.link!.uid)).toBe(false);

    const matchingRace = restoreWithMaterials(plantMaterialCodes);
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

  it("restores official Link.AddProcedure setcode filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const qualiarkCode = "92781606";
    const offSetMaterialCodes = ["900000171", "900000172"];
    const krawlerMaterialCodes = ["900000173", "900000174"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === qualiarkCode),
      ...offSetMaterialCodes.map((code, index) => ({
        code,
        name: `Off-Set Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        setcodes: [0x123],
      })),
      ...krawlerMaterialCodes.map((code, index) => ({
        code,
        name: `Krawler Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        setcodes: [0x104],
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 313, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [qualiarkCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === qualiarkCode && card.location === "extraDeck");
      expect(link).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(qualiarkCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({
        linkMaterialMin: 2,
        linkMaterialMax: 2,
        linkMaterialSetcode: 0x104,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(restored.missingChainLimitRegistryKeys).toEqual([]);
      expectRestoredLegalActions(restored, 0);
      return { restored, link };
    };

    const wrongSetcode = restoreWithMaterials(offSetMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongSetcode.restored, 0).some((action) => action.type === "linkSummon" && action.uid === wrongSetcode.link!.uid)).toBe(false);

    const matchingSetcode = restoreWithMaterials(krawlerMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingSetcode.restored, 0).filter((action) => action.type === "linkSummon" && action.uid === matchingSetcode.link!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingSetcode.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link Summon action");
    const summoned = applyLuaRestoreResponse(matchingSetcode.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingSetcode.restored.session.state.cards.find((card) => card.uid === matchingSetcode.link!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
    });
  });

  it("restores official Link.AddProcedure summon type filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const claraCode = "1482001";
    const unsummonedMaterialCode = "900000197";
    const normalSummonedMaterialCode = "900000198";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === claraCode),
      { code: unsummonedMaterialCode, name: "Unsummoned Link Material", kind: "monster" as const, typeFlags: 0x1, level: 4 },
      { code: normalSummonedMaterialCode, name: "Normal Summoned Link Material", kind: "monster" as const, typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterial = (code: string, normalSummoned: boolean) => {
      const session = createDuel({ seed: 320, startingHandSize: normalSummoned ? 1 : 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [code], extra: [claraCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === claraCode && card.location === "extraDeck");
      expect(link).toBeDefined();
      const material = session.state.cards.find((card) => card.code === code && (card.location === "hand" || card.location === "deck"));
      expect(material).toBeDefined();
      if (normalSummoned) {
        const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === material!.uid);
        expect(summon).toBeDefined();
        expect(applyResponse(session, summon!).ok).toBe(true);
      }
      else {
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main2";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(claraCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({
        linkMaterialMin: 1,
        linkMaterialMax: 1,
        linkMaterialSummonType: 0x10000000,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(restored.missingChainLimitRegistryKeys).toEqual([]);
      expectRestoredLegalActions(restored, 0);
      return { restored, link };
    };

    const unsummonedMaterial = restoreWithMaterial(unsummonedMaterialCode, false);
    expect(getLuaRestoreLegalActions(unsummonedMaterial.restored, 0).some((action) => action.type === "linkSummon" && action.uid === unsummonedMaterial.link!.uid)).toBe(false);

    const normalSummonedMaterial = restoreWithMaterial(normalSummonedMaterialCode, true);
    const actions = getLuaRestoreLegalActions(normalSummonedMaterial.restored, 0).filter((action) => action.type === "linkSummon" && action.uid === normalSummonedMaterial.link!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(normalSummonedMaterial.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link Summon action");
    const summoned = applyLuaRestoreResponse(normalSummonedMaterial.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(normalSummonedMaterial.restored.session.state.cards.find((card) => card.uid === normalSummonedMaterial.link!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
    });
  });

  it("restores official Link.AddProcedure level filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const linkuribohCode = "41999284";
    const levelTwoMaterialCode = "900000175";
    const levelOneMaterialCode = "900000176";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === linkuribohCode),
      { code: levelTwoMaterialCode, name: "Level 2 Link Material", kind: "monster" as const, typeFlags: 0x1, level: 2 },
      { code: levelOneMaterialCode, name: "Level 1 Link Material", kind: "monster" as const, typeFlags: 0x1, level: 1 },
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterial = (code: string) => {
      const session = createDuel({ seed: 316, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [code], extra: [linkuribohCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === linkuribohCode && card.location === "extraDeck");
      const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
      expect(link).toBeDefined();
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(linkuribohCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({
        linkMaterialMin: 1,
        linkMaterialLevel: 1,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(restored.missingChainLimitRegistryKeys).toEqual([]);
      expectRestoredLegalActions(restored, 0);
      return { restored, link };
    };

    const wrongLevel = restoreWithMaterial(levelTwoMaterialCode);
    expect(getLuaRestoreLegalActions(wrongLevel.restored, 0).some((action) => action.type === "linkSummon" && action.uid === wrongLevel.link!.uid)).toBe(false);

    const matchingLevel = restoreWithMaterial(levelOneMaterialCode);
    const actions = getLuaRestoreLegalActions(matchingLevel.restored, 0).filter((action) => action.type === "linkSummon" && action.uid === matchingLevel.link!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingLevel.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link Summon action");
    const summoned = applyLuaRestoreResponse(matchingLevel.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingLevel.restored.session.state.cards.find((card) => card.uid === matchingLevel.link!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
    });
  });

  it("uses restored Link material filters for Lua Duel.LinkSummon default material selection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const linkuribohCode = "41999284";
    const levelTwoMaterialCode = "900000209";
    const levelOneMaterialCode = "900000210";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === linkuribohCode),
      { code: levelTwoMaterialCode, name: "Level 2 Link Material", kind: "monster" as const, typeFlags: 0x1, level: 2 },
      { code: levelOneMaterialCode, name: "Level 1 Link Material", kind: "monster" as const, typeFlags: 0x1, level: 1 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 324, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [levelTwoMaterialCode, levelOneMaterialCode], extra: [linkuribohCode] }, 1: { main: [] } });
    startDuel(session);
    const link = session.state.cards.find((card) => card.code === linkuribohCode && card.location === "extraDeck");
    expect(link).toBeDefined();
    for (const code of [levelTwoMaterialCode, levelOneMaterialCode]) {
      const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(linkuribohCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({
      linkMaterialMin: 1,
      linkMaterialLevel: 1,
    });
    const result = host.loadScript(
      `
      local link=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${linkuribohCode}),0,LOCATION_EXTRA,0,1,1,nil):GetFirst()
      Debug.Message("default link level filter " .. Duel.LinkSummon(link))
      `,
      "linkuriboh-default-link.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("default link level filter 1");
    const summoned = session.state.cards.find((card) => card.uid === link!.uid);
    const levelTwoMaterial = session.state.cards.find((card) => card.code === levelTwoMaterialCode);
    const levelOneMaterial = session.state.cards.find((card) => card.code === levelOneMaterialCode);
    expect(summoned).toMatchObject({
      location: "monsterZone",
      summonType: "link",
      summonMaterialUids: [levelOneMaterial?.uid],
    });
    expect(levelTwoMaterial?.location).toBe("monsterZone");
  });

  it("skips material locks for Lua Duel.LinkSummon default material selection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const linkuribohCode = "41999284";
    const lockedMaterialCode = "900000214";
    const allowedMaterialCode = "900000215";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === linkuribohCode),
      { code: lockedMaterialCode, name: "Locked Level 1 Link Material", kind: "monster" as const, typeFlags: 0x1, level: 1 },
      { code: allowedMaterialCode, name: "Allowed Level 1 Link Material", kind: "monster" as const, typeFlags: 0x1, level: 1 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 326, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lockedMaterialCode, allowedMaterialCode], extra: [linkuribohCode] }, 1: { main: [] } });
    startDuel(session);
    const link = session.state.cards.find((card) => card.code === linkuribohCode && card.location === "extraDeck");
    expect(link).toBeDefined();
    for (const code of [lockedMaterialCode, allowedMaterialCode]) {
      const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(linkuribohCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({
      linkMaterialMin: 1,
      linkMaterialLevel: 1,
    });
    const result = host.loadScript(
      `
      local blocked=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${lockedMaterialCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local e=Effect.CreateEffect(blocked)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_CANNOT_BE_LINK_MATERIAL)
      e:SetRange(LOCATION_MZONE)
      blocked:RegisterEffect(e)
      local link=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${linkuribohCode}),0,LOCATION_EXTRA,0,1,1,nil):GetFirst()
      Debug.Message("default link material lock " .. Duel.LinkSummon(link))
      `,
      "linkuriboh-default-link-material-lock.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("default link material lock 1");
    const summoned = session.state.cards.find((card) => card.uid === link!.uid);
    const lockedMaterial = session.state.cards.find((card) => card.code === lockedMaterialCode);
    const allowedMaterial = session.state.cards.find((card) => card.code === allowedMaterialCode);
    expect(summoned).toMatchObject({
      location: "monsterZone",
      summonType: "link",
      summonMaterialUids: [allowedMaterial?.uid],
    });
    expect(lockedMaterial?.location).toBe("monsterZone");
  });

  it("restores official Link.AddProcedure minimum level filters for real extra deck summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const worldGearsCode = "57282724";
    const lowLevelMaterialCodes = ["900000177", "900000178", "900000179"];
    const highLevelMaterialCodes = ["900000180", "900000181", "900000182"];
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === worldGearsCode),
      ...lowLevelMaterialCodes.map((code, index) => ({
        code,
        name: `Level 4 Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 4,
      })),
      ...highLevelMaterialCodes.map((code, index) => ({
        code,
        name: `Level 5 Link Material ${index + 1}`,
        kind: "monster" as const,
        typeFlags: 0x1,
        level: 5,
      })),
    ];
    const reader = createCardReader(cards);
    const restoreWithMaterials = (main: string[]) => {
      const session = createDuel({ seed: 317, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
      loadDecks(session, { 0: { main, extra: [worldGearsCode] }, 1: { main: [] } });
      startDuel(session);
      const link = session.state.cards.find((card) => card.code === worldGearsCode && card.location === "extraDeck");
      expect(link).toBeDefined();
      for (const code of main) {
        const material = session.state.cards.find((card) => card.code === code && card.location === "deck");
        expect(material).toBeDefined();
        moveDuelCard(session.state, material!.uid, "monsterZone", 0);
      }
      session.state.phase = "main1";
      session.state.waitingFor = 0;
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(worldGearsCode), workspace).ok).toBe(true);
      expect(host.registerInitialEffects()).toBe(1);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({
        linkMaterialMin: 3,
        linkMaterialMax: 3,
        linkMaterialMinLevel: 5,
      });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
      expect(restored.missingRegistryKeys).toEqual([]);
      expect(restored.missingChainLimitRegistryKeys).toEqual([]);
      expectRestoredLegalActions(restored, 0);
      return { restored, link };
    };

    const wrongLevel = restoreWithMaterials(lowLevelMaterialCodes);
    expect(getLuaRestoreLegalActions(wrongLevel.restored, 0).some((action) => action.type === "linkSummon" && action.uid === wrongLevel.link!.uid)).toBe(false);

    const matchingLevel = restoreWithMaterials(highLevelMaterialCodes);
    const actions = getLuaRestoreLegalActions(matchingLevel.restored, 0).filter((action) => action.type === "linkSummon" && action.uid === matchingLevel.link!.uid);
    expect(actions, JSON.stringify(getLuaRestoreLegalActions(matchingLevel.restored, 0), null, 2)).toHaveLength(1);
    const action = actions[0];
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link Summon action");
    const summoned = applyLuaRestoreResponse(matchingLevel.restored, action);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(matchingLevel.restored.session.state.cards.find((card) => card.uid === matchingLevel.link!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
    });
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
