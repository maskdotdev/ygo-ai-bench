import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const cardTrooperCode = "85087012";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCardTrooperScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cardTrooperCode}.lua`));
const destroyerCode = "850870120";
const costCodes = ["850870121", "850870122", "850870123"] as const;
const drawCode = "850870124";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasCardTrooperScript)("Lua real script Card Trooper deck cost stat draw", () => {
  it("restores AnnounceNumber deck-send cost into ATK gain and destroyed-from-field draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cardTrooperCode}.lua`);
    expect(script).toContain("Duel.IsPlayerCanDiscardDeckAsCost(tp,1)");
    expect(script).toContain("Duel.AnnounceNumber(tp,table.unpack(ct))");
    expect(script).toContain("Duel.DiscardDeck(tp,ac,REASON_COST)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(ct*500)");
    expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 85087012, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cardTrooperCode, ...costCodes, drawCode] }, 1: { main: [destroyerCode] } });
    startDuel(session);

    const trooper = requireCard(session, cardTrooperCode);
    const costs = costCodes.map((code) => requireCard(session, code));
    const draw = requireCard(session, drawCode);
    const destroyer = requireCard(session, destroyerCode);
    moveDuelCard(session.state, trooper.uid, "monsterZone", 0).position = "faceUpAttack";
    trooper.faceUp = true;
    moveDuelCard(session.state, destroyer.uid, "monsterZone", 1).position = "faceUpAttack";
    destroyer.faceUp = true;
    costs.forEach((card, index) => {
      card.sequence = index;
      card.location = "deck";
      card.controller = 0;
    });
    draw.sequence = 3;
    draw.location = "deck";
    draw.controller = 0;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = realCardTrooperWithLocalSupport(workspace);
    const host = createLuaScriptHost(session, workspace);
    for (const code of [cardTrooperCode, destroyerCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, {
      promptOverrides: [{ api: "AnnounceNumber", player: 0, returned: 3 }],
    });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === trooper.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, boost!);
    expect(restoredOpen.host.promptDecisions.map((decision) => ({
      api: decision.api,
      player: decision.player,
      options: "options" in decision ? decision.options : undefined,
      returned: decision.returned,
    }))).toEqual([{ api: "AnnounceNumber", player: 0, options: [3, 2, 1], returned: 3 }]);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === trooper.uid), restoredOpen.session.state)).toBe(1900);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard")).toEqual([
      ...costs.map((card, index) => ({
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: card.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: trooper.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: index },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: index },
      })),
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: costs[0]!.uid,
        eventUids: costs.map((card) => card.uid),
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: trooper.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredBoosted = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader, {
      promptOverrides: [{ api: "AnnounceNumber", player: 0, returned: 3 }],
    });
    expectCleanRestore(restoredBoosted);
    expectRestoredLegalActions(restoredBoosted, 0);
    expect(currentAttack(restoredBoosted.session.state.cards.find((card) => card.uid === trooper.uid), restoredBoosted.session.state)).toBe(1900);

    restoredBoosted.session.state.turnPlayer = 1;
    restoredBoosted.session.state.waitingFor = 1;
    const restoredDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredBoosted.session), source, reader, {
      promptOverrides: [{ api: "AnnounceNumber", player: 0, returned: 3 }],
    });
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 1);
    const destroy = getLuaRestoreLegalActions(restoredDestroy, 1).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDestroy, destroy!);
    resolveRestoredChain(restoredDestroy);
    expect(restoredDestroy.session.state.cards.find((card) => card.uid === trooper.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: destroyer.uid,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroy.session), source, reader, {
      promptOverrides: [{ api: "AnnounceNumber", player: 0, returned: 3 }],
    });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === trooper.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === draw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: trooper.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 3 },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [draw.uid],
        eventCardUid: draw.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: trooper.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: cardTrooperCode, name: "Card Trooper", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 400, defense: 400 },
    { code: destroyerCode, name: "Card Trooper Opponent Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ...costCodes.map((code, index) => ({ code, name: `Card Trooper Deck Cost ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 })),
    { code: drawCode, name: "Card Trooper Draw Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function realCardTrooperWithLocalSupport(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${destroyerCode}.lua`) return destroyerScript();
      return workspace.readScript(name);
    },
  };
}

function destroyerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${cardTrooperCode}),tp,0,LOCATION_MZONE,nil)
        Duel.Destroy(tc,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
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
