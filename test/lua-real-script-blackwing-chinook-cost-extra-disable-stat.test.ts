import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const chinookCode = "34976176";
const hasChinookScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chinookCode}.lua`));
const synchroCode = "349761760";
const targetCode = "349761761";
const battleTargetCode = "349761762";
const responderCode = "349761763";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const attributeDark = 0x20;
const setBlackwing = 0x33;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasChinookScript)("Lua real script Blackwing Chinook cost extra disable stat", () => {
  it("restores SelfToGrave cost, Extra Deck send, target disable, and ATK reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chinookCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOGRAVE+CATEGORY_ATKCHANGE+CATEGORY_DISABLE)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE|LOCATION_HAND)");
    expect(script).toContain("e1:SetCondition(aux.NOT(s.quickcon))");
    expect(script).toContain("e1:SetCost(Cost.SelfToGrave)");
    expect(script).toContain("return c:IsAbleToGrave() and ((c:IsSetCard(SET_BLACKWING) and c:IsType(TYPE_SYNCHRO)) or c:IsCode(CARD_BLACK_WINGED_DRAGON))");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_EXTRA)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,tg,1,0,0)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_EXTRA,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
    expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e3:SetValue(-700)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === chinookCode),
      { code: synchroCode, name: "Chinook Fixture Blackwing Synchro", kind: "monster", typeFlags: typeMonster | typeEffect | typeSynchro, setcodes: [setBlackwing], attribute: attributeDark, level: 7, attack: 2400, defense: 1600 },
      { code: targetCode, name: "Chinook Disable Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2200, defense: 1200 },
      { code: battleTargetCode, name: "Chinook Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Chinook Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 34976176, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chinookCode], extra: [synchroCode] }, 1: { main: [targetCode, battleTargetCode, responderCode] } });
    startDuel(session);

    const chinook = requireCard(session, chinookCode);
    const synchro = requireCard(session, synchroCode);
    const target = requireCard(session, targetCode);
    const battleTarget = requireCard(session, battleTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, chinook.uid, "hand", 0);
    moveDuelCard(session.state, target.uid, "monsterZone", 1);
    target.position = "faceUpAttack";
    target.faceUp = true;
    moveDuelCard(session.state, battleTarget.uid, "monsterZone", 1);
    battleTarget.position = "faceUpAttack";
    battleTarget.faceUp = true;
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
    expect(host.loadCardScript(Number(chinookCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === chinook.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === chinook.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: chinook.uid,
    });
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: chinook.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [7],
        targetUids: [target.uid],
        operationInfos: [
          { category: 0x20, count: 1, parameter: 0x40, player: 0, targetUids: [] },
          { category: 0x4000, count: 1, parameter: 0, player: 0, targetUids: [target.uid] },
        ],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passChain(restoredChain, 1);
    expect(restoredChain.host.messages).not.toContain("blackwing chinook responder resolved");

    const restoredSynchro = requireCard(restoredChain.session, synchroCode);
    const disabledTarget = requireCard(restoredChain.session, targetCode);
    expect(restoredSynchro).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: chinook.uid,
    });
    expect(currentAttack(disabledTarget, restoredChain.session.state)).toBe(1500);
    expect(isCardDisabled(restoredChain.session.state, disabledTarget, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === disabledTarget.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 2, event: "continuous", reset: { flags: 1107169792 }, value: undefined },
      { code: 8, event: "continuous", reset: { flags: 1107169792 }, value: 131072 },
      { code: 100, event: "continuous", reset: { flags: 1107169792 }, value: -700 },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: chinook.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: chinook.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: synchro.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: chinook.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
    ]);

    restoredChain.session.state.phase = "battle";
    restoredChain.session.state.turnPlayer = 1;
    restoredChain.session.state.waitingFor = 1;
    const attack = getLegalActions(restoredChain.session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === disabledTarget.uid && action.targetUid === undefined);
    expect(attack, JSON.stringify(getLegalActions(restoredChain.session, 1), null, 2)).toBeDefined();
    const attackResponse = applyResponse(restoredChain.session, attack!);
    expect(attackResponse.ok, attackResponse.error).toBe(true);
    passBattleResponses(restoredChain.session);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 1500, 1: 0 });
    expect(restoredChain.session.state.players[0].lifePoints).toBe(6500);
    expect(restoredChain.session.state.cards.find((card) => card.uid === disabledTarget.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({ location: "monsterZone" });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("blackwing chinook responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
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

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    const response = applyResponse(session, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
