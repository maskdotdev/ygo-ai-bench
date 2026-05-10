import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.cards.find((card) => card.uid === triEdge!.uid)?.data.xyzMaterialCount).toBe(3);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
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
      expect(host.registerInitialEffects()).toBeGreaterThan(0);
      expect(session.state.cards.find((card) => card.uid === link!.uid)?.data).toMatchObject({ linkMaterialMin: 2, linkMaterialMax: 2 });
      const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
      expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    expect(hasActivateEffect(getDuelLegalActions(session, 0), monsterReborn!.uid)).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
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
