import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const pendulumType = 0x1000001;
const typeMonster = 0x1;
const raceWarrior = 0x1;
const raceDragon = 0x2000;
const attributeFire = 0x4;
const attributeDark = 0x20;
const setIgknight = 0xc8;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Igknight Paladin PZONE search", () => {
  it("destroys both Pendulum Zone cards to the Extra Deck before searching a FIRE Warrior", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const igknightCode = "24019092";
    const otherScaleId = "24019093";
    const searchTargetId = "24019094";
    const invalidTargetId = "24019095";
    const responderId = "24019096";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === igknightCode),
      { code: otherScaleId, name: "Igknight PZONE Fixture", kind: "monster", typeFlags: pendulumType, level: 4, race: raceDragon, attribute: attributeDark, leftScale: 8, rightScale: 8, setcodes: [setIgknight] },
      { code: searchTargetId, name: "Igknight Search FIRE Warrior", kind: "monster", typeFlags: typeMonster, level: 4, race: raceWarrior, attribute: attributeFire, attack: 1700, defense: 1000 },
      { code: invalidTargetId, name: "Igknight Rejected Dark Warrior", kind: "monster", typeFlags: typeMonster, level: 4, race: raceWarrior, attribute: attributeDark, attack: 1800, defense: 1200 },
      { code: responderId, name: "Igknight Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 240, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [igknightCode, otherScaleId, searchTargetId, invalidTargetId] }, 1: { main: [responderId] } });
    startDuel(session);

    const igknight = session.state.cards.find((card) => card.code === igknightCode);
    const otherScale = session.state.cards.find((card) => card.code === otherScaleId);
    const searchTarget = session.state.cards.find((card) => card.code === searchTargetId);
    const invalidTarget = session.state.cards.find((card) => card.code === invalidTargetId);
    const responder = session.state.cards.find((card) => card.code === responderId);
    expect(igknight).toBeDefined();
    expect(otherScale).toBeDefined();
    expect(searchTarget).toBeDefined();
    expect(invalidTarget).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, igknight!.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, otherScale!.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderId}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(igknightCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderId), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpen.restoreComplete, restoredOpen.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpen.missingRegistryKeys).toEqual([]);
    expect(restoredOpen.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredOpen, 0);

    const igknightAction = findIgknightPzoneIgnition(restoredOpen.session, getLuaRestoreLegalActions(restoredOpen, 0), igknight!.uid);
    expect(igknightAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, igknightAction!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.chain[0]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-3",
      id: "chain-2",
      operationInfos: [
        { category: 0x1, targetUids: [igknight!.uid, otherScale!.uid], count: 2, player: 0, parameter: 0 },
        { category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x11 },
      ],
      player: 0,
      sourceUid: igknight!.uid,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.session.state.chain).toHaveLength(1);
    expect(restoredChain.session.state.chain[0]).toEqual(restoredOpen.session.state.chain[0]);

    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === igknight!.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: igknight!.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === otherScale!.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: igknight!.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === searchTarget!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: igknight!.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === invalidTarget!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["destroyed", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: igknight!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: igknight!.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, location: "spellTrapZone", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "extraDeck", sequence: 0, position: "faceDown", faceUp: true },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: otherScale!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: igknight!.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, location: "spellTrapZone", sequence: 1, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "extraDeck", sequence: 1, position: "faceDown", faceUp: true },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: igknight!.uid,
        eventUids: [igknight!.uid, otherScale!.uid],
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: igknight!.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, location: "spellTrapZone", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "extraDeck", sequence: 0, position: "faceDown", faceUp: true },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: igknight!.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 1,
        eventUids: [searchTarget!.uid],
        eventValue: 1,
        eventCardUid: searchTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: igknight!.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventPlayer: 1,
        eventUids: [searchTarget!.uid],
        eventValue: 1,
        eventCardUid: searchTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: igknight!.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
      },
    ]);
    expect(restoredChain.host.messages).toEqual([`confirmed 1: ${searchTargetId}`]);
    expect(restoredChain.host.messages).not.toContain("igknight responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("igknight responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function findIgknightPzoneIgnition(session: DuelSession, actions: DuelAction[], uid: string): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return effect?.range.includes("spellTrapZone") === true;
  });
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
