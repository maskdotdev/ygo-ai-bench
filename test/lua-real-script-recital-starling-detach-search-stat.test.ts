import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const recitalCode = "8491961";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRecitalScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${recitalCode}.lua`));
const materialACode = "84919610";
const materialBCode = "84919611";
const searchCode = "84919612";
const decoyCode = "84919613";
const responderCode = "84919614";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWingedBeast = 0x200;
const attributeWind = 0x8;
const summonTypeXyz = 0x49000000;

describe.skipIf(!hasUpstreamScripts || !hasRecitalScript)("Lua real script Lyrilusc Recital Starling detach search stat", () => {
  it("restores Xyz summon metadata, overlay-count stat trigger, battle-damage modifier, and detach search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${recitalCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,1,2,nil,nil,Xyz.InfiniteMats)");
    expect(script).toContain("return e:GetHandler():IsXyzSummoned() and e:GetHandler():GetOverlayCount()>0");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCode(EFFECT_ALSO_BATTLE_DAMAGE)");
    expect(script).toContain("return e:GetHandler():IsXyzSummoned()");
    expect(script).toContain("e3:SetCost(Cost.DetachFromSelf(1))");
    expect(script).toContain("return c:GetLevel()==1 and c:IsRace(RACE_WINGEDBEAST) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      { code: recitalCode, name: "Lyrilusc - Recital Starling", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 1, attack: 0, defense: 0 },
      { code: materialACode, name: "Recital Starling Material A", kind: "monster", typeFlags: typeMonster, race: raceWingedBeast, attribute: attributeWind, level: 1, attack: 100, defense: 100 },
      { code: materialBCode, name: "Recital Starling Material B", kind: "monster", typeFlags: typeMonster, race: raceWingedBeast, attribute: attributeWind, level: 1, attack: 100, defense: 100 },
      { code: searchCode, name: "Recital Starling Winged Beast Search", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 1, attack: 500, defense: 500 },
      { code: decoyCode, name: "Recital Starling Level Two Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 2, attack: 500, defense: 500 },
      { code: responderCode, name: "Recital Starling Chain Responder", kind: "monster", typeFlags: typeMonster, race: raceWingedBeast, attribute: attributeWind, level: 1, attack: 100, defense: 100 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8491961, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode, searchCode, decoyCode], extra: [recitalCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const recital = requireCard(session, recitalCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const search = requireCard(session, searchCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, recital, 0);
    recital.summonType = "xyz";
    recital.summonTypeCode = summonTypeXyz;
    moveDuelCard(session.state, materialA.uid, "overlay", 0).sequence = 0;
    moveDuelCard(session.state, materialB.uid, "overlay", 0).sequence = 1;
    recital.overlayUids.push(materialA.uid, materialB.uid);
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
    expect(host.loadCardScript(Number(recitalCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(recital.data).toMatchObject({ xyzMaterialCount: 2, xyzMaterialMax: 99 });
    expect(session.state.effects.filter((effect) => effect.sourceUid === recital.uid).map((effect) => ({
      event: effect.event,
      code: effect.code,
      range: effect.range,
      category: effect.category,
    }))).toEqual([
      { event: "continuous", code: 31, range: ["monsterZone"], category: undefined },
      { event: "trigger", code: 1102, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], category: 0x200000 | 0x400000 },
      { event: "continuous", code: 207, range: ["monsterZone"], category: undefined },
      { event: "ignition", code: undefined, range: ["monsterZone"], category: 0x8 | 0x20000 },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const searchAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === recital.uid && action.effectId === "lua-4");
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, searchAction!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-4",
        sourceUid: recital.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === recital.uid)?.overlayUids).toEqual([materialB.uid]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: recital.uid,
      reasonEffectId: 4,
    });
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.host.messages).toContain(`confirmed 1: ${searchCode}`);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === search.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: recital.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === recital.uid), restoredOpen.session.state)).toBe(0);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === recital.uid), restoredOpen.session.state)).toBe(0);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: materialA.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: recital.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: search.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: recital.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: recital.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: search.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [search.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: recital.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
      e:SetOperation(function(e,tp) Debug.Message("recital starling responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
