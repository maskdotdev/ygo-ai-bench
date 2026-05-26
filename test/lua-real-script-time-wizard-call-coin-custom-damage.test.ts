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
const timeWizardCode = "71625222";
const ownAllyCode = "716252220";
const opponentAcode = "716252221";
const opponentBcode = "716252222";
const responderCode = "716252223";
const hasTimeWizardScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${timeWizardCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryDestroy = 0x1;
const categoryDamage = 0x80000;
const categoryCoin = 0x1000000;
const eventCustomTimeWizard = 0x10000000 + Number(timeWizardCode);

describe.skipIf(!hasUpstreamScripts || !hasTimeWizardScript)("Lua real script Time Wizard CallCoin custom damage", () => {
  it("restores CallCoin destroy branches, operated-group previous ATK damage, and custom event raise", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${timeWizardCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const heads = resolveTimeWizard({ seed: 10, reader, workspace });
    const headsTimeWizard = requireCard(heads.session, timeWizardCode);
    const opponentA = requireCard(heads.session, opponentAcode);
    const opponentB = requireCard(heads.session, opponentBcode);
    expect(heads.session.state.lastCoinResults).toEqual([1]);
    expect(heads.session.state.cards.find((card) => card.uid === headsTimeWizard.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(heads.session.state.cards.find((card) => card.uid === opponentA.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.destroy | duelReason.effect, reasonPlayer: 0, reasonCardUid: headsTimeWizard.uid, reasonEffectId: 1 });
    expect(heads.session.state.cards.find((card) => card.uid === opponentB.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.destroy | duelReason.effect, reasonPlayer: 0, reasonCardUid: headsTimeWizard.uid, reasonEffectId: 1 });
    expect(heads.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(summarizeEvents(heads.session.state.eventHistory.filter((event) => event.eventName === "coinTossed" || event.eventName === "destroyed" || event.eventName === "customEvent"))).toEqual([
      coinEvent(headsTimeWizard.uid, 0, 1),
      destroyedEvent(opponentA.uid, headsTimeWizard.uid, undefined),
      destroyedEvent(opponentB.uid, headsTimeWizard.uid, undefined),
      destroyedEvent(opponentA.uid, headsTimeWizard.uid, [opponentA.uid, opponentB.uid]),
      {
        eventName: "customEvent",
        eventCode: eventCustomTimeWizard,
        eventCardUid: headsTimeWizard.uid,
        eventPlayer: 0,
        eventValue: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: headsTimeWizard.uid,
        eventReasonEffectId: 1,
        eventUids: [headsTimeWizard.uid],
        relatedEffectId: 1,
      },
    ]);

    const tails = resolveTimeWizard({ seed: 1, reader, workspace });
    const tailsTimeWizard = requireCard(tails.session, timeWizardCode);
    const ownAlly = requireCard(tails.session, ownAllyCode);
    expect(tails.session.state.lastCoinResults).toEqual([0]);
    expect(tails.session.state.cards.find((card) => card.uid === tailsTimeWizard.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.destroy | duelReason.effect, reasonPlayer: 0, reasonCardUid: tailsTimeWizard.uid, reasonEffectId: 1 });
    expect(tails.session.state.cards.find((card) => card.uid === ownAlly.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.destroy | duelReason.effect, reasonPlayer: 0, reasonCardUid: tailsTimeWizard.uid, reasonEffectId: 1 });
    expect(tails.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(tails.session.state.players[0].lifePoints).toBe(6750);
    expect(tails.session.state.players[1].lifePoints).toBe(8000);
    expect(summarizeEvents(tails.session.state.eventHistory.filter((event) => event.eventName === "coinTossed" || event.eventName === "destroyed" || event.eventName === "damageDealt"))).toEqual([
      coinEvent(tailsTimeWizard.uid, 0, 1),
      destroyedEvent(tailsTimeWizard.uid, tailsTimeWizard.uid, undefined),
      destroyedEvent(ownAlly.uid, tailsTimeWizard.uid, undefined),
      destroyedEvent(tailsTimeWizard.uid, tailsTimeWizard.uid, [tailsTimeWizard.uid, ownAlly.uid]),
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventCardUid: undefined,
        eventPlayer: 0,
        eventValue: 1250,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tailsTimeWizard.uid,
        eventReasonEffectId: 1,
        eventUids: undefined,
        relatedEffectId: undefined,
      },
    ]);
  });
});

function resolveTimeWizard({
  seed,
  reader,
  workspace,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [timeWizardCode, ownAllyCode] }, 1: { main: [opponentAcode, opponentBcode, responderCode] } });
  startDuel(session);
  const timeWizard = requireCard(session, timeWizardCode);
  const ownAlly = requireCard(session, ownAllyCode);
  const opponentA = requireCard(session, opponentAcode);
  const opponentB = requireCard(session, opponentBcode);
  const responder = requireCard(session, responderCode);
  moveFaceUpAttack(session, timeWizard.uid, 0, 0);
  moveFaceUpAttack(session, ownAlly.uid, 0, 1);
  moveFaceUpAttack(session, opponentA.uid, 1, 0);
  moveFaceUpAttack(session, opponentB.uid, 1, 1);
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
  expect(host.loadCardScript(Number(timeWizardCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);
  const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === timeWizard.uid);
  expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, activation!);
  expect(restoredOpen.session.state.chain).toEqual([
    {
      id: "chain-2",
      chainIndex: 1,
      effectId: "lua-1",
      sourceUid: timeWizard.uid,
      player: 0,
      activationLocation: "monsterZone",
      activationSequence: 0,
      operationInfos: [
        { category: categoryCoin, targetUids: [], count: 0, player: 0, parameter: 1 },
        { category: categoryDestroy, targetUids: [timeWizard.uid, ownAlly.uid, opponentA.uid, opponentB.uid], count: 1, player: 0, parameter: 0 },
      ],
      possibleOperationInfos: [{ category: categoryDamage, targetUids: [], count: 1, player: 0, parameter: 0 }],
    },
  ]);

  const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
  expectCleanRestore(restoredChain);
  expectRestoredLegalActions(restoredChain, 1);
  expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
  passRestoredChain(restoredChain, 1);
  expect(restoredChain.host.messages).not.toContain("time wizard responder resolved");
  return restoredChain;
}

function cards(): DuelCardData[] {
  return [
    { code: timeWizardCode, name: "Time Wizard", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 500, defense: 400 },
    { code: ownAllyCode, name: "Time Wizard Own Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
    { code: opponentAcode, name: "Time Wizard Opponent A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1000 },
    { code: opponentBcode, name: "Time Wizard Opponent B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
    { code: responderCode, name: "Time Wizard Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Time Wizard");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_COIN+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DAMAGE,nil,1,tp,0)");
  expect(script).toContain("if Duel.CallCoin(tp) then");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_MZONE)");
  expect(script).toContain("Duel.RaiseEvent(e:GetHandler(),EVENT_CUSTOM+id,e,0,0,tp,0)");
  expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_MZONE,0)");
  expect(script).toContain("Duel.GetOperatedGroup():Filter(Card.IsPreviousPosition,nil,POS_FACEUP)");
  expect(script).toContain("dg:GetSum(Card.GetPreviousAttackOnField)");
  expect(script).toContain("Duel.Damage(tp,sum/2,REASON_EFFECT)");
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
      e:SetOperation(function(e,tp) Debug.Message("time wizard responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId, sequence: number): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
  card.sequence = sequence;
}

function coinEvent(sourceUid: string, player: PlayerId, effectId: number) {
  return {
    eventName: "coinTossed",
    eventCode: 1151,
    eventCardUid: undefined,
    eventPlayer: player,
    eventValue: 1,
    eventReason: duelReason.effect,
    eventReasonPlayer: player,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventUids: undefined,
    relatedEffectId: undefined,
  };
}

function destroyedEvent(cardUid: string, sourceUid: string, eventUids: string[] | undefined) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventPlayer: undefined,
    eventValue: undefined,
    eventReason: duelReason.destroy | duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventUids,
    relatedEffectId: undefined,
  };
}

function summarizeEvents(events: DuelSession["state"]["eventHistory"]) {
  return events.map((event) => ({
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    eventUids: event.eventUids,
    relatedEffectId: event.relatedEffectId,
  }));
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
