import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const purpleCode = "84569886";
const hasPurpleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${purpleCode}.lua`));
const targetCode = "845698860";
const destroyerCode = "845698861";
const responderCode = "845698862";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typePendulum = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasPurpleScript)("Lua real script Purple Armageddon destroy PZone", () => {
  it("restores targeted monster destruction damage and destroyed trigger placement into the Pendulum Zone", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${purpleCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c,false)");
    expect(script).toContain("Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_DDD),2)");
    expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsPosition,tp,0,LOCATION_MZONE,1,1,nil,POS_FACEUP_ATTACK)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,atk)");
    expect(script).toContain("if Duel.Destroy(tc,REASON_EFFECT)~=0 then");
    expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");

    const cards: DuelCardData[] = [
      { code: purpleCode, name: "D/D/D Super Doom King Purple Armageddon", kind: "monster", typeFlags: typeMonster | typeEffect | typeFusion | typePendulum, level: 10, attack: 3500, defense: 3000, leftScale: 1, rightScale: 1 },
      { code: targetCode, name: "Purple Armageddon Attack Position Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1000 },
      { code: destroyerCode, name: "Purple Armageddon Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Purple Armageddon Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 84569886, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [targetCode], extra: [purpleCode] }, 1: { main: [destroyerCode, responderCode] } });
    startDuel(session);

    const purple = requireCard(session, purpleCode);
    const target = requireCard(session, targetCode);
    const destroyer = requireCard(session, destroyerCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, purple.uid, "monsterZone", 0).position = "faceUpAttack";
    purple.faceUp = true;
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    target.faceUp = true;
    moveDuelCard(session.state, destroyer.uid, "monsterZone", 1).position = "faceUpAttack";
    destroyer.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript(purpleCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(purpleCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroyerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === purple.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, ignition!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: purple.uid,
        player: 0,
        effectId: "lua-4",
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetFieldIds: [6],
        operationInfos: [
          { category: 0x1, targetUids: [target.uid], count: 1, player: 0, parameter: 0 },
          { category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 1200 },
        ],
        targetUids: [target.uid],
      },
    ]);

    const restoredIgnitionChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredIgnitionChain);
    expectRestoredLegalActions(restoredIgnitionChain, 1);
    expect(getLuaRestoreLegalActions(restoredIgnitionChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passChain(restoredIgnitionChain, 1);
    expect(restoredIgnitionChain.session.state.players[1].lifePoints).toBe(6800);
    expect(restoredIgnitionChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: purple.uid,
      reasonEffectId: 4,
    });
    expect(restoredIgnitionChain.host.messages).not.toContain("purple armageddon responder resolved");

    restoredIgnitionChain.session.state.turnPlayer = 1;
    restoredIgnitionChain.session.state.waitingFor = 1;
    const restoredDestroyerOpen = restoreDuelWithLuaScripts(serializeDuel(restoredIgnitionChain.session), source, reader);
    expectCleanRestore(restoredDestroyerOpen);
    expectRestoredLegalActions(restoredDestroyerOpen, 1);
    const destroyPurple = getLuaRestoreLegalActions(restoredDestroyerOpen, 1).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroyPurple, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyerOpen, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDestroyerOpen, destroyPurple!);
    passChain(restoredDestroyerOpen, 1);
    expect(restoredDestroyerOpen.session.state.cards.find((card) => card.uid === purple.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: destroyer.uid,
      reasonEffectId: 7,
    });

    const restoredPzoneTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyerOpen.session), source, reader);
    expectCleanRestore(restoredPzoneTrigger);
    expectRestoredLegalActions(restoredPzoneTrigger, 0);
    const pzoneTrigger = getLuaRestoreLegalActions(restoredPzoneTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === purple.uid);
    expect(pzoneTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredPzoneTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPzoneTrigger, pzoneTrigger!);
    expect(restoredPzoneTrigger.session.state.chain).toEqual([
      {
        id: "chain-9",
        chainIndex: 1,
        sourceUid: purple.uid,
        player: 0,
        effectId: "lua-6-1029",
        activationLocation: "extraDeck",
        activationSequence: 0,
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: purple.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 7,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
    ]);
    passChain(restoredPzoneTrigger, 1);
    expect(restoredPzoneTrigger.session.state.cards.find((card) => card.uid === purple.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: purple.uid,
      reasonEffectId: 6,
    });
    expect(restoredPzoneTrigger.session.state.eventHistory.filter((event) => ["destroyed", "moved"].includes(event.eventName))).toEqual([
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: target.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: purple.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: purple.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: purple.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 7,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: purple.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 7,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: purple.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: purple.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function destroyerScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(Card.IsCode,tp,0,LOCATION_MZONE,nil,${targetCode})
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
      e:SetOperation(function(e,tp) Debug.Message("purple armageddon responder resolved") end)
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const raw = getLuaRestoreLegalActions(restored, player);
  const grouped = getLuaRestoreLegalActionGroups(restored, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}
