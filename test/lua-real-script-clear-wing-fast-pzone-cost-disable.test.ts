import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const fastCode = "90036274";
const tunerCode = "900362740";
const nonTunerCode = "900362741";
const targetCode = "900362742";
const destroyerCode = "900362743";
const responderCode = "900362744";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasFastScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fastCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const typePendulum = 0x1000000;
const setSpeedroid = 0x2016;
const attributeWind = 0x8;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasFastScript)("Lua real script Clear Wing Fast Dragon PZone cost disable", () => {
  it("restores PZone material cost summon, Extra Deck target ATK 0/disable, and destroyed PZone placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${fastCode}.lua`);
    expect(script).toContain("Synchro.NonTunerEx(Card.IsAttribute,ATTRIBUTE_WIND)");
    expect(script).toContain("Pendulum.AddProcedure(c,false)");
    expect(script).toContain("aux.ChkfMMZ(1)(sg,e,tp,mg)");
    expect(script).toContain("sg:CheckWithSumEqual(Card.GetLevel,7,2,2)");
    expect(script).toContain("aux.SelectUnselectGroup(g1+g2,e,tp,2,2,s.rescon,1,tp,HINTMSG_TOGRAVE)");
    expect(script).toContain("Duel.SendtoGrave(sg,REASON_COST)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.SelectTarget(tp,s.disfilter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
    expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fastCode),
      { code: tunerCode, name: "Fast Dragon Speedroid Tuner Cost", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, level: 3, attack: 1000, defense: 1000, attribute: attributeWind, setcodes: [setSpeedroid] },
      { code: nonTunerCode, name: "Fast Dragon WIND Non-Tuner Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1400, defense: 1200, attribute: attributeWind },
      { code: targetCode, name: "Fast Dragon Extra-Summoned Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeSynchro, level: 7, attack: 2600, defense: 2000, attribute: attributeDark },
      { code: destroyerCode, name: "Fast Dragon Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1200 },
      { code: responderCode, name: "Fast Dragon Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 90036274, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tunerCode, nonTunerCode], extra: [fastCode] }, 1: { main: [targetCode, destroyerCode, responderCode] } });
    startDuel(session);

    const fast = requireCard(session, fastCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    const target = requireCard(session, targetCode);
    const destroyer = requireCard(session, destroyerCode);
    const responder = requireCard(session, responderCode);
    movePzone(session, fast, 0, 0);
    moveFaceUpAttack(session, tuner, 0);
    moveFaceUpAttack(session, nonTuner, 0);
    moveFaceUpAttack(session, target, 1);
    target.summonType = "synchro";
    target.summonPlayer = 1;
    target.previousLocation = "extraDeck";
    moveFaceUpAttack(session, destroyer, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript(fastCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [fastCode, destroyerCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === fast.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    passRestoredChain(restoredOpen);
    for (const material of [tuner, nonTuner]) {
      expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: fast.uid,
      });
    }
    expect(restoredOpen.session.state.cards.find((card) => card.uid === fast.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: fast.uid,
    });

    restoredOpen.session.state.waitingFor = 0;
    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const disable = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === fast.uid);
    expect(disable, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, disable!);
    passRestoredChain(restoredQuick);
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === target.uid), restoredQuick.session.state)).toBe(0);
    expect(restoredQuick.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [2, 3].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 2, reset: { flags: 1107169792 }, value: undefined }]);

    restoredQuick.session.state.turnPlayer = 1;
    restoredQuick.session.state.waitingFor = 1;
    const restoredDestroyerOpen = restoreDuelWithLuaScripts(serializeDuel(restoredQuick.session), source, reader);
    expectCleanRestore(restoredDestroyerOpen);
    expectRestoredLegalActions(restoredDestroyerOpen, 1);
    const destroy = getLuaRestoreLegalActions(restoredDestroyerOpen, 1).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyerOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyerOpen, destroy!);
    passRestoredChain(restoredDestroyerOpen);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyerOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-11-1",
        effectId: "lua-6-1029",
        sourceUid: fast.uid,
        player: 0,
        triggerBucket: "opponentOptional",
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: fast.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 7,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventTriggerTiming: "if",
      },
    ]);
    const pzone = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === fast.uid);
    expect(pzone, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, pzone!);
    passRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === fast.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fast.uid,
      reasonEffectId: 6,
    });
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function destroyerScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),tp,0,LOCATION_MZONE,nil)
        if tc then Duel.Destroy(tc,REASON_EFFECT) end
      end)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("fast dragon responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
