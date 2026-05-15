import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Lightning Storm select effect", () => {
  it("restores Lightning Storm's selected attack-position monster destroy mode", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lightningStormCode = "14532163";
    const opponentAttackerCode = "994";
    const opponentSecondAttackerCode = "995";
    const opponentDefenseCode = "996";
    const opponentBackrowCode = "997";
    const responderCode = "998";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lightningStormCode),
      { code: opponentAttackerCode, name: "Lightning Storm Attack Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: opponentSecondAttackerCode, name: "Lightning Storm Second Attack Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1000 },
      { code: opponentDefenseCode, name: "Lightning Storm Defense Non-Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 900, defense: 2000 },
      { code: opponentBackrowCode, name: "Lightning Storm Backrow Non-Target", kind: "trap", typeFlags: 0x4 },
      { code: responderCode, name: "Lightning Storm Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 994, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [lightningStormCode] },
      1: { main: [opponentAttackerCode, opponentSecondAttackerCode, opponentDefenseCode, opponentBackrowCode, responderCode] },
    });
    startDuel(session);

    const lightningStorm = session.state.cards.find((card) => card.code === lightningStormCode);
    const opponentAttacker = session.state.cards.find((card) => card.code === opponentAttackerCode);
    const opponentSecondAttacker = session.state.cards.find((card) => card.code === opponentSecondAttackerCode);
    const opponentDefense = session.state.cards.find((card) => card.code === opponentDefenseCode);
    const opponentBackrow = session.state.cards.find((card) => card.code === opponentBackrowCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(lightningStorm).toBeDefined();
    expect(opponentAttacker).toBeDefined();
    expect(opponentSecondAttacker).toBeDefined();
    expect(opponentDefense).toBeDefined();
    expect(opponentBackrow).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, lightningStorm!.uid, "hand", 0);
    moveDuelCard(session.state, opponentAttacker!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentSecondAttacker!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentDefense!.uid, "monsterZone", 1).position = "faceUpDefense";
    moveDuelCard(session.state, opponentBackrow!.uid, "spellTrapZone", 1);
    opponentBackrow!.position = "faceDown";
    opponentBackrow!.faceUp = false;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const { source, host } = loadLightningStormHost(session, workspace, lightningStormCode, responderCode);

    const lightningStormAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lightningStorm!.uid);
    expect(lightningStormAction).toBeDefined();
    applyAndAssert(session, lightningStormAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: lightningStorm!.uid,
      effectLabel: 1,
      operationInfos: [{ category: 0x1, count: 2, player: 0, parameter: 0 }],
    });
    expect(sortedUids(session.state.chain[0]!.operationInfos?.[0]?.targetUids ?? [])).toEqual(sortedUids([opponentAttacker!.uid, opponentSecondAttacker!.uid]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain[0]).toMatchObject({
      sourceUid: lightningStorm!.uid,
      effectLabel: 1,
      operationInfos: [{ category: 0x1, count: 2, player: 0, parameter: 0 }],
    });

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === lightningStorm!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentAttacker!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentSecondAttacker!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDefense!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentBackrow!.uid)).toMatchObject({ location: "spellTrapZone" });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: opponentAttacker!.uid }),
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: opponentSecondAttacker!.uid }),
      ]),
    );
    expect(host.messages).not.toContain("lightning storm responder resolved");
    expect(restored.host.messages).not.toContain("lightning storm responder resolved");
  });

  it("restores Lightning Storm's selected Spell/Trap destroy mode", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lightningStormCode = "14532163";
    const ownBackrowCode = "999";
    const opponentDefenseCode = "1000";
    const opponentTrapCode = "1001";
    const opponentSpellCode = "1002";
    const responderCode = "1003";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lightningStormCode),
      { code: ownBackrowCode, name: "Lightning Storm Ally Backrow", kind: "trap", typeFlags: 0x4 },
      { code: opponentDefenseCode, name: "Lightning Storm Defense Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 900, defense: 2000 },
      { code: opponentTrapCode, name: "Lightning Storm Opponent Trap", kind: "trap", typeFlags: 0x4 },
      { code: opponentSpellCode, name: "Lightning Storm Opponent Spell", kind: "spell", typeFlags: 0x2 },
      { code: responderCode, name: "Lightning Storm Backrow Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1000, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lightningStormCode, ownBackrowCode] }, 1: { main: [opponentDefenseCode, opponentTrapCode, opponentSpellCode, responderCode] } });
    startDuel(session);

    const lightningStorm = session.state.cards.find((card) => card.code === lightningStormCode);
    const ownBackrow = session.state.cards.find((card) => card.code === ownBackrowCode);
    const opponentDefense = session.state.cards.find((card) => card.code === opponentDefenseCode);
    const opponentTrap = session.state.cards.find((card) => card.code === opponentTrapCode);
    const opponentSpell = session.state.cards.find((card) => card.code === opponentSpellCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(lightningStorm).toBeDefined();
    expect(ownBackrow).toBeDefined();
    expect(opponentDefense).toBeDefined();
    expect(opponentTrap).toBeDefined();
    expect(opponentSpell).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, lightningStorm!.uid, "hand", 0);
    moveDuelCard(session.state, ownBackrow!.uid, "spellTrapZone", 0);
    ownBackrow!.position = "faceDown";
    ownBackrow!.faceUp = false;
    moveDuelCard(session.state, opponentDefense!.uid, "monsterZone", 1).position = "faceUpDefense";
    moveDuelCard(session.state, opponentTrap!.uid, "spellTrapZone", 1);
    opponentTrap!.position = "faceDown";
    opponentTrap!.faceUp = false;
    moveDuelCard(session.state, opponentSpell!.uid, "spellTrapZone", 1);
    opponentSpell!.position = "faceUpAttack";
    opponentSpell!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const { source } = loadLightningStormHost(session, workspace, lightningStormCode, responderCode);

    const lightningStormAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lightningStorm!.uid);
    expect(lightningStormAction).toBeDefined();
    applyAndAssert(session, lightningStormAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: lightningStorm!.uid,
      effectLabel: 2,
      operationInfos: [{ category: 0x1, count: 2, player: 0, parameter: 0 }],
    });
    expect(sortedUids(session.state.chain[0]!.operationInfos?.[0]?.targetUids ?? [])).toEqual(sortedUids([opponentTrap!.uid, opponentSpell!.uid]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain[0]).toMatchObject({
      sourceUid: lightningStorm!.uid,
      effectLabel: 2,
      operationInfos: [{ category: 0x1, count: 2, player: 0, parameter: 0 }],
    });

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === lightningStorm!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownBackrow!.uid)).toMatchObject({ location: "spellTrapZone" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDefense!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentTrap!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentSpell!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: opponentTrap!.uid }),
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: opponentSpell!.uid }),
      ]),
    );
    expect(restored.host.messages).not.toContain("lightning storm responder resolved");
  });
});

function loadLightningStormHost(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, lightningStormCode: string, responderCode: string) {
  const source = {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(lightningStormCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return { source, host };
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("lightning storm responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function sortedUids(uids: string[]): string[] {
  return [...uids].sort();
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
