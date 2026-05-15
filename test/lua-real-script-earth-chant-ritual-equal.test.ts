import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script exact Ritual Summons", () => {
  it("restores AddProcEqual and selects exact-level Ritual materials", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const earthChantCode = "59820352";
    const ritualTargetCode = "5982";
    const materialACode = "5983";
    const materialBCode = "5984";
    const materialCCode = "5985";
    const responderCode = "5986";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === earthChantCode),
      { code: ritualTargetCode, name: "Earth Chant Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 6, attribute: 0x1, attack: 2200, defense: 1800 },
      { code: materialACode, name: "Earth Chant Level 4 Material A Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      { code: materialBCode, name: "Earth Chant Level 4 Material B Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1300, defense: 1000 },
      { code: materialCCode, name: "Earth Chant Level 2 Material Fixture", kind: "monster", typeFlags: 0x1, level: 2, attack: 700, defense: 800 },
      { code: responderCode, name: "Earth Chant Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 598, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [earthChantCode, ritualTargetCode, materialACode, materialBCode, materialCCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const earthChant = session.state.cards.find((card) => card.code === earthChantCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const materialA = session.state.cards.find((card) => card.code === materialACode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    const materialC = session.state.cards.find((card) => card.code === materialCCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(earthChant).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(materialA).toBeDefined();
    expect(materialB).toBeDefined();
    expect(materialC).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, earthChant!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, materialA!.uid, "hand", 0);
    moveDuelCard(session.state, materialB!.uid, "hand", 0);
    moveDuelCard(session.state, materialC!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(earthChantCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === earthChant!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-59820352-0",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
      summonMaterialUids: [materialA!.uid, materialC!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === materialA!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === materialB!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === materialC!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === earthChant!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: ritualTarget!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.ritual,
        eventReasonPlayer: 0,
        eventReasonCardUid: earthChant!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.host.messages).not.toContain("earth chant responder resolved");
  });

  it("restores AddProcEqualCode into an exact-code Ritual Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const luminousDragonRitualCode = "34834619";
    const paladinCode = "85346853";
    const decoyMaterialCode = "3483";
    const exactMaterialCode = "3484";
    const responderCode = "3485";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === luminousDragonRitualCode || card.code === paladinCode),
      { code: decoyMaterialCode, name: "Luminous Dragon Level 5 Decoy Fixture", kind: "monster", typeFlags: 0x1, level: 5, attack: 1600, defense: 1200 },
      { code: exactMaterialCode, name: "Luminous Dragon Level 4 Material Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 1000 },
      { code: responderCode, name: "Luminous Dragon Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 348, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [luminousDragonRitualCode, paladinCode, decoyMaterialCode, exactMaterialCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const ritualSpell = session.state.cards.find((card) => card.code === luminousDragonRitualCode);
    const paladin = session.state.cards.find((card) => card.code === paladinCode);
    const decoyMaterial = session.state.cards.find((card) => card.code === decoyMaterialCode);
    const exactMaterial = session.state.cards.find((card) => card.code === exactMaterialCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(ritualSpell).toBeDefined();
    expect(paladin).toBeDefined();
    expect(decoyMaterial).toBeDefined();
    expect(exactMaterial).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, ritualSpell!.uid, "hand", 0);
    moveDuelCard(session.state, paladin!.uid, "hand", 0);
    moveDuelCard(session.state, decoyMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, exactMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(luminousDragonRitualCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === ritualSpell!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-34834619-0",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === paladin!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
      summonMaterialUids: [exactMaterial!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === exactMaterial!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === decoyMaterial!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === ritualSpell!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: paladin!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.ritual,
        eventReasonPlayer: 0,
        eventReasonCardUid: ritualSpell!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.host.messages).not.toContain("earth chant responder resolved");
  });

  it("restores Ritual forcedselection material requirements", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const secretsCode = "59514116";
    const ritualTargetCode = "5951";
    const decoyMaterialCode = "5952";
    const darkMagicianCode = "46986414";
    const responderCode = "5953";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === secretsCode),
      { code: ritualTargetCode, name: "Secrets Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 4, attack: 1800, defense: 1200 },
      { code: decoyMaterialCode, name: "Secrets Level 4 Decoy Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 1000 },
      { code: darkMagicianCode, name: "Dark Magician Forced Ritual Fixture", kind: "monster", typeFlags: 0x1, level: 7, attack: 2500, defense: 2100 },
      { code: responderCode, name: "Secrets Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 595, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [secretsCode, ritualTargetCode, darkMagicianCode, decoyMaterialCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const secrets = session.state.cards.find((card) => card.code === secretsCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const decoyMaterial = session.state.cards.find((card) => card.code === decoyMaterialCode);
    const darkMagician = session.state.cards.find((card) => card.code === darkMagicianCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(secrets).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(decoyMaterial).toBeDefined();
    expect(darkMagician).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, secrets!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, darkMagician!.uid, "hand", 0);
    moveDuelCard(session.state, decoyMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(secretsCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === secrets!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-2-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-59514116-0",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
      summonMaterialUids: [darkMagician!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === darkMagician!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === decoyMaterial!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === secrets!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("earth chant responder resolved");
  });

  it("restores Ritual requirementfunc material value callbacks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const meteonisCode = "22398665";
    const ritualTargetCode = "2231";
    const validMaterialCode = "2232";
    const decoyMaterialCode = "2233";
    const responderCode = "2234";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === meteonisCode),
      { code: ritualTargetCode, name: "Meteonis Attack Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 8, attack: 2000, defense: 1800 },
      { code: validMaterialCode, name: "Meteonis Attack Material Fixture", kind: "monster", typeFlags: 0x1, level: 1, race: 0x20, attack: 2000, defense: 0 },
      { code: decoyMaterialCode, name: "Meteonis Low Attack Decoy Fixture", kind: "monster", typeFlags: 0x1, level: 1, race: 0x20, attack: 1000, defense: 0 },
      { code: responderCode, name: "Meteonis Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 223, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [meteonisCode, ritualTargetCode, validMaterialCode, decoyMaterialCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const meteonis = session.state.cards.find((card) => card.code === meteonisCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const validMaterial = session.state.cards.find((card) => card.code === validMaterialCode);
    const decoyMaterial = session.state.cards.find((card) => card.code === decoyMaterialCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(meteonis).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(validMaterial).toBeDefined();
    expect(decoyMaterial).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, meteonis!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, validMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, decoyMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(meteonisCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === meteonis!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 18,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-22398665-0",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
      summonMaterialUids: [validMaterial!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === validMaterial!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === decoyMaterial!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === meteonis!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("earth chant responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("earth chant responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
