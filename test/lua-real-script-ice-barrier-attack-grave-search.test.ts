import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const iceBarrierCode = "34293667";
const attackerCode = "342936670";
const defenderCode = "342936671";
const waterSendCode = "342936672";
const waterRecoverCode = "342936673";
const waterDecoyCode = "342936674";
const responderCode = "342936675";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasIceBarrierScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${iceBarrierCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const attributeWater = 0x2;
const attributeDark = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasIceBarrierScript)("Lua real script Ice Barrier attack grave search", () => {
  it("restores attack-announce Trap activation into attacker negation, final ATK zero, and position lock", () => {
    const { workspace, source } = sourceWithResponder();
    const script = workspace.readScript(`official/c${iceBarrierCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DISABLE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("local _,bc=Duel.GetBattleMonster(tp)");
    expect(script).toContain("Duel.SetTargetCard(bc)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,bc,1,tp,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,bc,1,tp,0)");
    expect(script).toContain("bc:NegateEffects(c)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_CHANGE_POSITION)");

    const reader = createCardReader(iceBarrierCards());
    const session = createDuel({ seed: 34293667, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [iceBarrierCode, defenderCode] }, 1: { main: [attackerCode, responderCode] } });
    startDuel(session);

    const iceBarrier = requireCard(session, iceBarrierCode);
    const defender = requireCard(session, defenderCode);
    const attacker = requireCard(session, attackerCode, 1);
    const responder = requireCard(session, responderCode, 1);
    const setTrap = moveDuelCard(session.state, iceBarrier.uid, "spellTrapZone", 0);
    setTrap.position = "faceDown";
    setTrap.faceUp = false;
    moveFaceUpAttack(session, defender, 0, 0);
    moveFaceUpAttack(session, attacker, 1, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    for (const code of [iceBarrierCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const activateTrap = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === iceBarrier.uid);
    expect(activateTrap, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, activateTrap!);
    expect(restoredResponse.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1-1130",
        sourceUid: iceBarrier.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: attacker.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventUids: [attacker.uid, defender.uid],
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        targetFieldIds: [7],
        targetUids: [attacker.uid],
        operationInfos: [
          { category: 0x200000, count: 1, parameter: 0, player: 0, targetUids: [attacker.uid] },
          { category: 0x4000, count: 1, parameter: 0, player: 0, targetUids: [attacker.uid] },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("ice barrier responder resolved");

    const restoredAttacker = requireCard(restoredChain.session, attackerCode, 1);
    expect(currentAttack(restoredAttacker, restoredChain.session.state)).toBe(0);
    expect(isCardDisabled(restoredChain.session.state, restoredAttacker, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && [2, 8, 14, 102].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 2, property: 1024, reset: { count: 1, flags: 33427456 }, sourceUid: attacker.uid, value: undefined },
      { code: 8, property: 1024, reset: { count: 1, flags: 33427456 }, sourceUid: attacker.uid, value: 131072 },
      { code: 102, property: 67109888, reset: { flags: 33427456 }, sourceUid: attacker.uid, value: 0 },
      { code: 14, property: 67109888, reset: { flags: 33427456 }, sourceUid: attacker.uid, value: 0 },
    ]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === iceBarrier.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["attackDeclared", "becameTarget"].includes(event.eventName)).map((event) => event.eventName)).toEqual([
      "attackDeclared",
      "becameTarget",
    ]);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores grave Cost.SelfBanish, WATER deck send, optional BreakEffect retrieval, and confirmation", () => {
    const { workspace, source } = sourceWithResponder();
    const script = workspace.readScript(`official/c${iceBarrierCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_TOGRAVE+CATEGORY_TOHAND)");
    expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("return c:IsLevelAbove(5) and c:IsAttribute(ATTRIBUTE_WATER) and c:IsAbleToGrave()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_GRAVE)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,3))");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");

    const reader = createCardReader(iceBarrierCards());
    const session = createDuel({ seed: 34293668, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [iceBarrierCode, waterSendCode, waterRecoverCode, waterDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const iceBarrier = requireCard(session, iceBarrierCode);
    const waterSend = requireCard(session, waterSendCode);
    const waterRecover = requireCard(session, waterRecoverCode);
    const waterDecoy = requireCard(session, waterDecoyCode);
    const responder = requireCard(session, responderCode, 1);
    moveDuelCard(session.state, iceBarrier.uid, "graveyard", 0).turnId = 0;
    moveDuelCard(session.state, waterRecover.uid, "graveyard", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const promptOverrides = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];
    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    for (const code of [iceBarrierCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === iceBarrier.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === iceBarrier.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: iceBarrier.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x20, count: 1, parameter: 1, player: 0, targetUids: [] }]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader, { promptOverrides });
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("ice barrier responder resolved");
    expect(restoredChain.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 548698675, returned: true },
    ]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === waterSend.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: iceBarrier.uid,
      reasonEffectId: 2,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === waterRecover.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: iceBarrier.uid,
      reasonEffectId: 2,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === waterDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["banished", "sentToGraveyard", "breakEffect", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => event.eventName)).toEqual([
      "banished",
      "sentToGraveyard",
      "breakEffect",
      "sentToHand",
      "confirmed",
      "sentToHandConfirmed",
    ]);
  });
});

function sourceWithResponder() {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  return {
    workspace,
    source: {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    },
  };
}

function iceBarrierCards(): DuelCardData[] {
  return [
    { code: iceBarrierCode, name: "Ice Barrier", kind: "trap", typeFlags: typeTrap },
    { code: attackerCode, name: "Ice Barrier Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, level: 4, attack: 2000, defense: 1200 },
    { code: defenderCode, name: "Ice Barrier Defender", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 4, attack: 1000, defense: 1600 },
    { code: waterSendCode, name: "Ice Barrier WATER Send Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 6, attack: 1800, defense: 1400 },
    { code: waterRecoverCode, name: "Ice Barrier WATER Recovery", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 4, attack: 1500, defense: 1000 },
    { code: waterDecoyCode, name: "Ice Barrier Off-Attribute Deck Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, level: 7, attack: 2400, defense: 1800 },
    { code: responderCode, name: "Ice Barrier Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("ice barrier responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
