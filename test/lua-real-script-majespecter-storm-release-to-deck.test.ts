import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const stormCode = "13972452";
const hasStormScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${stormCode}.lua`));
const windSpellcasterCode = "13972453";
const wrongRaceCostCode = "13972454";
const deckTargetCode = "13972455";
const otherTargetCode = "13972456";
const responderCode = "13972457";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeWind = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasStormScript)("Lua real script Majespecter Storm release to Deck", () => {
  it("restores aux.ReleaseCheckTarget release cost into targeted opponent monster shuffle", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${stormCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TODECK)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsRace(RACE_SPELLCASTER) and c:IsAttribute(ATTRIBUTE_WIND)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,aux.ReleaseCheckTarget,nil,dg)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,aux.ReleaseCheckTarget,nil,dg)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToDeck,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,g,1,0,0)");
    expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: stormCode, name: "Majespecter Storm", kind: "spell", typeFlags: typeSpell },
      { code: windSpellcasterCode, name: "Majespecter Storm WIND Spellcaster Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeWind, level: 4, attack: 1500, defense: 1000 },
      { code: wrongRaceCostCode, name: "Majespecter Storm Wrong Race Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 4, attack: 1700, defense: 1000 },
      { code: deckTargetCode, name: "Majespecter Storm Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: otherTargetCode, name: "Majespecter Storm Other Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
      { code: responderCode, name: "Majespecter Storm Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 13972452, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [stormCode, windSpellcasterCode, wrongRaceCostCode] }, 1: { main: [deckTargetCode, otherTargetCode, responderCode] } });
    startDuel(session);

    const storm = requireCard(session, stormCode);
    const windSpellcaster = requireCard(session, windSpellcasterCode);
    const wrongRaceCost = requireCard(session, wrongRaceCostCode);
    const deckTarget = requireCard(session, deckTargetCode);
    const otherTarget = requireCard(session, otherTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, storm.uid, "hand", 0);
    moveFaceUpMonster(session, windSpellcaster.uid, 0, 0);
    moveFaceUpMonster(session, wrongRaceCost.uid, 0, 1);
    moveFaceUpMonster(session, deckTarget.uid, 1, 0);
    moveFaceUpMonster(session, otherTarget.uid, 1, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(stormCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === storm.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === windSpellcaster.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: storm.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === wrongRaceCost.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: storm.uid,
        player: 0,
        effectId: "lua-1-1002",
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [10],
        targetUids: [deckTarget.uid],
        operationInfos: [{ category: 0x10, targetUids: [deckTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChain, pass!);

    expect(restoredChain.session.state.chain).toEqual([]);
    expect(restoredChain.host.messages).not.toContain("majespecter storm responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === storm.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.rule });
    expect(restoredChain.session.state.cards.find((card) => card.uid === deckTarget.uid)).toMatchObject({ location: "deck", controller: 1, reason: duelReason.effect });
    expect(restoredChain.session.state.cards.find((card) => card.uid === otherTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["released", "sentToDeck"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: windSpellcaster.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: storm.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: deckTarget.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "deck", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: storm.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpMonster(session: DuelSession, uid: string, controller: PlayerId, sequence: number): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.sequence = sequence;
  card.position = "faceUpAttack";
  card.faceUp = true;
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
      e:SetOperation(function(e,tp) Debug.Message("majespecter storm responder resolved") end)
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
