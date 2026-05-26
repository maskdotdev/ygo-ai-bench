import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const reezeCode = "36331074";
const costCode = "363310740";
const ownGustoCode = "363310741";
const opponentTargetCode = "363310742";
const ownNonGustoCode = "363310743";
const responderCode = "363310744";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasReezeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${reezeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePsychic = 0x100000;
const raceWarrior = 0x1;
const attributeWind = 0x8;
const attributeEarth = 0x1;
const setGusto = 0x10;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasReezeScript)("Lua real script Reeze Gusto deck-cost swap control", () => {
  it("restores hand bottom-deck cost into dual targeting and SwapControl", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${reezeCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 36331074, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [reezeCode, costCode, ownGustoCode, ownNonGustoCode] },
      1: { main: [opponentTargetCode, responderCode] },
    });
    startDuel(session);

    const reeze = requireCard(session, reezeCode);
    const cost = requireCard(session, costCode);
    const ownGusto = requireCard(session, ownGustoCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const ownNonGusto = requireCard(session, ownNonGustoCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, reeze, 0, 0);
    moveDuelCard(session.state, cost.uid, "hand", 0);
    moveFaceUpAttack(session, ownGusto, 0, 1);
    moveFaceUpAttack(session, ownNonGusto, 0, 2);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
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
    expect(host.loadCardScript(Number(reezeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === reeze.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"] },
    ]);

    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === reeze.uid
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);

    expect(findCard(restoredOpen.session, cost.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: reeze.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.chain.map((link) => ({
      operationInfos: link.operationInfos,
      player: link.player,
      sourceUid: link.sourceUid,
      targetUids: link.targetUids,
    }))).toEqual([
      {
        operationInfos: [{ category: categoryControl, targetUids: [reeze.uid, opponentTarget.uid], count: 2, player: 0, parameter: 0 }],
        player: 0,
        sourceUid: reeze.uid,
        targetUids: [reeze.uid, opponentTarget.uid],
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToDeck", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToDeck", eventCardUid: cost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: reeze.uid, eventReasonEffectId: 1, eventUids: undefined, previousLocation: "hand", currentLocation: "deck" },
      { eventName: "becameTarget", eventCardUid: reeze.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "becameTarget", eventCardUid: opponentTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, previousLocation: "deck", currentLocation: "monsterZone" },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, pass!);

    expect(findCard(restoredChain.session, reeze.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: reeze.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredChain.session, opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: reeze.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredChain.session, ownGusto.uid)).toMatchObject({ controller: 0, location: "monsterZone" });
    expect(findCard(restoredChain.session, ownNonGusto.uid)).toMatchObject({ controller: 0, location: "monsterZone" });
    expect(restoredChain.host.messages).not.toContain("reeze responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "controlChanged").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "controlChanged", eventCardUid: reeze.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: reeze.uid, eventReasonEffectId: 1, eventUids: undefined, previousController: 0, currentController: 1 },
      { eventName: "controlChanged", eventCardUid: opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: reeze.uid, eventReasonEffectId: 1, eventUids: undefined, previousController: 1, currentController: 0 },
      { eventName: "controlChanged", eventCardUid: reeze.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: reeze.uid, eventReasonEffectId: 1, eventUids: [reeze.uid, opponentTarget.uid], previousController: 0, currentController: 1 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: reezeCode, name: "Reeze, Whirlwind of Gusto", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeWind, level: 5, attack: 1900, defense: 1400, setcodes: [setGusto] },
    { code: costCode, name: "Reeze Hand Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeWind, level: 3, attack: 1000, defense: 1000, setcodes: [setGusto] },
    { code: ownGustoCode, name: "Reeze Own Gusto Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeWind, level: 4, attack: 1600, defense: 1200, setcodes: [setGusto] },
    { code: opponentTargetCode, name: "Reeze Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: ownNonGustoCode, name: "Reeze Own Non-Gusto Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1400, defense: 1400 },
    { code: responderCode, name: "Reeze Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Reeze, Whirlwind of Gusto");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsAbleToDeckAsCost,tp,LOCATION_HAND,0,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToDeckAsCost,tp,LOCATION_HAND,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKBOTTOM,REASON_COST)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_GUSTO) and c:IsAbleToChangeControler()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter1,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter2,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g1,2,0,0)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("Duel.SwapControl(a,b)");
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
      e:SetOperation(function(e,tp) Debug.Message("reeze responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
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
