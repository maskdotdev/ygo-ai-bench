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
const aleisterCode = "86120751";
const invocationCode = "74063034";
const fusionCode = "861207510";
const responderCode = "861207511";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAleisterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${aleisterCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasAleisterScript)("Lua real script Aleister self-grave stat search", () => {
  it("restores hand SelfToGrave Fusion stat boost and summon-success Invocation search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${aleisterCode}.lua`);
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("e1:SetCost(Cost.SelfToGrave)");
    expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_FUSION)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e3:SetCode(EVENT_FLIP)");
    expect(script).toContain("return c:IsCode(74063034) and c:IsAbleToHand()");
    expect(script).toContain("Duel.GetFirstMatchingCard(s.thfilter,tp,LOCATION_DECK,0,nil)");
    expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");

    const cards: DuelCardData[] = [
      { code: aleisterCode, name: "Aleister the Invoker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1000, defense: 1800 },
      { code: invocationCode, name: "Invocation", kind: "spell", typeFlags: typeSpell },
      { code: fusionCode, name: "Aleister Fusion Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeDark, level: 8, attack: 2500, defense: 2000 },
      { code: responderCode, name: "Aleister Chain Responder", kind: "monster", typeFlags: typeMonster, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 86120751, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [aleisterCode, invocationCode], extra: [fusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const aleister = requireCard(session, aleisterCode);
    const invocation = requireCard(session, invocationCode);
    const fusion = requireCard(session, fusionCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, aleister.uid, "hand", 0);
    moveFaceUpAttack(session, fusion, 0);
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
    expect(host.loadCardScript(Number(aleisterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === aleister.uid && action.effectId === "lua-1-1002");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === aleister.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: aleister.uid,
      reasonEffectId: 1,
    });
    passRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === fusion.uid), restoredOpen.session.state)).toBe(3500);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === fusion.uid), restoredOpen.session.state)).toBe(3000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === fusion.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x400, reset: { flags: 1107169792 }, value: 1000 },
      { code: 104, property: 0x400, reset: { flags: 1107169792 }, value: 1000 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: aleister.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: aleister.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: fusion.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);

    const summonSession = createDuel({ seed: 86120752, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [aleisterCode, invocationCode] }, 1: { main: [responderCode] } });
    startDuel(summonSession);
    const summonAleister = requireCard(summonSession, aleisterCode);
    const summonInvocation = requireCard(summonSession, invocationCode);
    const summonResponder = requireCard(summonSession, responderCode);
    moveDuelCard(summonSession.state, summonAleister.uid, "hand", 0);
    moveDuelCard(summonSession.state, summonResponder.uid, "hand", 1);
    summonSession.state.phase = "main1";
    summonSession.state.turnPlayer = 0;
    summonSession.state.waitingFor = 0;
    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(aleisterCode), source).ok).toBe(true);
    expect(summonHost.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(2);
    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(summonSession), source, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const normalSummon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === summonAleister.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, normalSummon!);
    const triggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), source, reader);
    expectCleanRestore(triggerWindow);
    expectRestoredLegalActions(triggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(triggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === summonAleister.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(triggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(triggerWindow, trigger!);
    expect(triggerWindow.session.state.chain).toHaveLength(1);
    expect(triggerWindow.session.state.chain[0]!.operationInfos).toBeDefined();
    expectRestoredLegalActions(triggerWindow, 1);
    expect(getLuaRestoreLegalActions(triggerWindow, 1).some((action) => action.type === "activateEffect" && action.uid === summonResponder.uid)).toBe(true);
    passRestoredChain(triggerWindow);
    expect(triggerWindow.session.state.chain).toEqual([]);
    expect(triggerWindow.host.messages).toContain(`confirmed 1: ${invocationCode}`);
    expect(triggerWindow.session.state.cards.find((card) => card.uid === summonInvocation.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonAleister.uid,
      reasonEffectId: 2,
    });
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
      e:SetOperation(function(e,tp) Debug.Message("aleister responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
