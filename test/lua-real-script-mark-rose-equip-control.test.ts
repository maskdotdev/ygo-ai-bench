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
const markCode = "45247637";
const plantCostCode = "452476370";
const targetCode = "452476371";
const responderCode = "452476372";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMarkScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${markCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeEquip = 0x40000;
const racePlant = 0x400;
const raceWarrior = 0x1;
const categoryControl = 0x2000;
const categoryEquip = 0x40000;
const effectEquipLimit = 76;
const effectSetControl = 4;

describe.skipIf(!hasUpstreamScripts || !hasMarkScript)("Lua real script Mark of the Rose equip control", () => {
  it("restores Plant GY cost, steal equip targeting, and control transfer", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${markCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 45247637, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [markCode, plantCostCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const mark = requireCard(session, markCode);
    const plantCost = requireCard(session, plantCostCode);
    const stealTarget = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, mark.uid, "hand", 0);
    moveDuelCard(session.state, plantCost.uid, "graveyard", 0);
    moveFaceUpAttack(session, stealTarget, 1, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(markCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const equip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === mark.uid);
    expect(equip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, equip!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === plantCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: mark.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.chain.map((link) => ({
      activationLocation: link.activationLocation,
      effectId: link.effectId,
      player: link.player,
      sourceUid: link.sourceUid,
      targetUids: link.targetUids,
      operationInfos: link.operationInfos,
    }))).toEqual([{
      activationLocation: "hand",
      effectId: "lua-1-1002",
      player: 0,
      sourceUid: mark.uid,
      targetUids: [stealTarget.uid],
      operationInfos: [
        { category: categoryControl, targetUids: [stealTarget.uid], count: 1, player: 0, parameter: 0 },
        { category: categoryEquip, targetUids: [mark.uid], count: 1, player: 0, parameter: 0 },
      ],
    }]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("mark rose responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === mark.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      equippedToUid: stealTarget.uid,
      faceUp: true,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === stealTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: mark.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === mark.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryEquip, code: 1002, countLimit: undefined, event: "ignition", range: ["hand", "spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectEquipLimit, countLimit: undefined, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectSetControl, countLimit: undefined, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: 4608, countLimit: 1, event: "trigger", range: ["spellTrapZone"], triggerEvent: "phaseEnd" },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["banished", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      controller: event.eventCurrentState?.controller,
    }))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: plantCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: mark.uid,
        eventReasonEffectId: 1,
        previous: "graveyard",
        current: "banished",
        controller: 0,
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: stealTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        previous: "deck",
        current: "monsterZone",
        controller: 1,
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: stealTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: mark.uid,
        eventReasonEffectId: 1,
        previous: "monsterZone",
        current: "monsterZone",
        controller: 0,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Mark of the Rose");
  expect(script).toContain("aux.AddEquipProcedure(c,1,aux.CheckStealEquip,s.eqlimit,s.cost,s.target)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_CONTROL)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e:SetCategory(CATEGORY_CONTROL+CATEGORY_EQUIP)");
  expect(script).toContain("EVENT_PHASE+PHASE_END");
  expect(script).toContain("SetFlagEffectLabel");
}

function cards(): DuelCardData[] {
  return [
    { code: markCode, name: "Mark of the Rose", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: plantCostCode, name: "Mark of the Rose Plant Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, level: 4, attack: 1000, defense: 1000 },
    { code: targetCode, name: "Mark of the Rose Steal Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1000 },
    { code: responderCode, name: "Mark of the Rose Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
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
      e:SetOperation(function(e,tp) Debug.Message("mark rose responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
