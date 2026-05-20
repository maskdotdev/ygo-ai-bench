import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const saturnCode = "34004470";
const discardCode = "340044700";
const responderCode = "340044701";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSaturnScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${saturnCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasSaturnScript)("Lua real script Big Saturn cost stat destroy damage", () => {
  it("restores LP/discard ignition cost into ATK gain and effect-destroyed both-player damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${saturnCode}.lua`);
    expect(script).toContain("Duel.CheckLPCost(tp,1000)");
    expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
    expect(script).toContain("Duel.PayLPCost(tp,1000)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
    expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("(r&(REASON_DESTROY|REASON_EFFECT))==(REASON_DESTROY|REASON_EFFECT)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,PLAYER_ALL,dam)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Damage(1-tp,d,REASON_EFFECT,true)");
    expect(script).toContain("Duel.Damage(tp,d,REASON_EFFECT,true)");
    expect(script).toContain("Duel.RDComplete()");

    const cards: DuelCardData[] = [
      { code: saturnCode, name: "The Big Saturn", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 2800, defense: 2200 },
      { code: discardCode, name: "Big Saturn Discard Cost", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Big Saturn Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 34004470, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [saturnCode, discardCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const saturn = requireCard(session, saturnCode);
    const discard = requireCard(session, discardCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, saturn.uid, 0);
    moveDuelCard(session.state, discard.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(saturnCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === saturn.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, ignition!);

    expect(restoredOpen.session.state.players[0].lifePoints).toBe(7000);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === saturn.uid), restoredOpen.session.state)).toBe(2800);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: saturn.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["discarded", "lifePointCostPaid"].includes(event.eventName))).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discard.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: saturn.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: saturn.uid,
        eventReasonEffectId: 2,
      },
    ]);

    const restoredIgnitionChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredIgnitionChain);
    expectRestoredLegalActions(restoredIgnitionChain, 1);
    expect(getLuaRestoreLegalActions(restoredIgnitionChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredIgnitionChain);

    const boostedSaturn = restoredIgnitionChain.session.state.cards.find((card) => card.uid === saturn.uid);
    expect(currentAttack(boostedSaturn, restoredIgnitionChain.session.state)).toBe(3800);
    expect(restoredIgnitionChain.host.messages).not.toContain("big saturn responder resolved");

    const restoredBoosted = restoreDuelWithLuaScripts(serializeDuel(restoredIgnitionChain.session), source, reader);
    expectCleanRestore(restoredBoosted);
    expectRestoredLegalActions(restoredBoosted, 0);
    const destroyed = destroyDuelCard(restoredBoosted.session.state, saturn.uid, 1, duelReason.effect | duelReason.destroy, 1);
    expect(destroyed).toMatchObject({ location: "graveyard", owner: 0, controller: 1, faceUp: true, previousController: 0 });
    expect(restoredBoosted.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-3-1014",
        sourceUid: saturn.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: saturn.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBoosted.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === saturn.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in trigger! ? trigger!.operationInfos : []) ?? []).toEqual([]);
    applyRestoredAction(restoredTrigger, trigger!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.session.state.chain).toEqual([
      {
        id: "chain-7",
        chainIndex: 1,
        effectId: "lua-3-1014",
        sourceUid: saturn.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: saturn.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 2800 }],
        targetParam: 2800,
      },
    ]);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("big saturn responder resolved");
    expect(restoredChain.session.state.players[0].lifePoints).toBe(4200);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(5200);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 2800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: saturn.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 2800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: saturn.uid,
        eventReasonEffectId: 3,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("big saturn responder resolved") end)
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
