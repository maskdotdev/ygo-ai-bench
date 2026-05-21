import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const assaultCode = "46985799";
const statTargetCode = "469857990";
const zeroAtkDecoyCode = "469857991";
const responderCode = "469857992";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAssaultScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${assaultCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasAssaultScript)("Lua real script Black Rose Dragon Assault reveal shuffle stat", () => {
  it("restores SelfReveal hand ignition into self Deck shuffle and nonzero ATK final zero", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${assaultCode}.lua`);
    expect(script).toContain("c:EnableReviveLimit()");
    expect(script).toContain("c:AddMustBeSpecialSummoned()");
    expect(script).toContain("e2:SetCategory(CATEGORY_TODECK+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e2:SetRange(LOCATION_HAND)");
    expect(script).toContain("e2:SetCost(Cost.SelfReveal)");
    expect(script).toContain("c:IsAbleToDeck() and Duel.IsExistingMatchingCard(Card.HasNonZeroAttack,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,c,1,tp,0)");
    expect(script).toContain("Duel.SendtoDeck(c,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)>0");
    expect(script).toContain("Duel.SelectMatchingCard(tp,Card.HasNonZeroAttack,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil):GetFirst()");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 46985799, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [assaultCode, statTargetCode, zeroAtkDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const assault = requireCard(session, assaultCode);
    const statTarget = requireCard(session, statTargetCode);
    const zeroAtkDecoy = requireCard(session, zeroAtkDecoyCode);
    const responder = requireCard(session, responderCode, 1);
    moveDuelCard(session.state, assault.uid, "hand", 0);
    moveFaceUpAttack(session, statTarget, 0);
    moveFaceUpAttack(session, zeroAtkDecoy, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(assaultCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === assault.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-4",
        sourceUid: assault.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x10, targetUids: [assault.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "confirmed")).toEqual([
      confirmedEvent(assault.uid),
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("black rose responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === assault.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: assault.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === statTarget.uid), restoredChain.session.state)).toBe(0);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === zeroAtkDecoy.uid), restoredChain.session.state)).toBe(0);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToDeck", "deckShuffled"].includes(event.eventName))).toEqual([
      sentToDeckEvent(assault.uid),
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: assaultCode, name: "Black Rose Dragon/Assault Mode", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 10, attack: 3500, defense: 2400 },
    { code: statTargetCode, name: "Black Rose Assault Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 4, attack: 2400, defense: 1000 },
    { code: zeroAtkDecoyCode, name: "Black Rose Assault Zero ATK Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 4, attack: 0, defense: 1000 },
    { code: responderCode, name: "Black Rose Assault Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("black rose responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function confirmedEvent(cardUid: string) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: 0,
    eventReasonPlayer: 0,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function sentToDeckEvent(cardUid: string) {
  return {
    eventName: "sentToDeck",
    eventCode: 1013,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: cardUid,
    eventReasonEffectId: 4,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
  };
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
