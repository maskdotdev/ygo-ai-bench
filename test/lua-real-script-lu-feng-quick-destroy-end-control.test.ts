import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const luFengCode = "82791472";
const ancientWarriorCode = "827914720";
const highTargetCode = "827914721";
const endControlTargetCode = "827914722";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setAncientWarriors = 0x137;
const raceBeastWarrior = 0x400000;
const attributeDark = 0x20;
const categoryDestroy = 0x1;
const categoryControl = 0x2000;
const effectCannotActivate = 6;
const eventPhaseEnd = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ancient Warriors Lu Feng quick destroy end control", () => {
  it("restores custom chain activity cost into highest-ATK destroy and End Phase opponent control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${luFengCode}.lua`);
    expect(script).toContain("--Ancient Warriors - Rebellious Lu Feng");
    expect(script).toContain("c:EnableReviveLimit()");
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
    expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_ANCIENT_WARRIORS),tp,LOCATION_MZONE,LOCATION_MZONE,nil):GetMaxGroup(Card.GetAttack)");
    expect(script).toContain("Duel.AddCustomActivityCounter(id,ACTIVITY_CHAIN,s.chainfilter)");
    expect(script).toContain("Duel.GetCustomActivityCount(id,tp,ACTIVITY_CHAIN)==0");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_OATH+EFFECT_FLAG_CLIENT_HINT)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ACTIVATE)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil):GetMaxGroup(Card.GetAttack)");
    expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
    expect(script).toContain("e4:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("return g and g:IsExists(Card.IsControler,1,nil,1-tp)");
    expect(script).toContain("Duel.GetControl(c,1-tp)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === luFengCode),
      { code: ancientWarriorCode, name: "Lu Feng Ancient Warriors Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, setcodes: [setAncientWarriors], level: 4, attack: 1600, defense: 1000 },
      { code: highTargetCode, name: "Lu Feng Highest Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 3200, defense: 1000 },
      { code: endControlTargetCode, name: "Lu Feng End Phase Highest Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 3000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 82791472, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [luFengCode, ancientWarriorCode] }, 1: { main: [highTargetCode, endControlTargetCode] } });
    startDuel(session);

    const luFeng = requireCard(session, luFengCode);
    const ally = requireCard(session, ancientWarriorCode);
    const highTarget = requireCard(session, highTargetCode);
    const endControlTarget = requireCard(session, endControlTargetCode);
    moveFaceUpAttack(session, luFeng, 0);
    moveFaceUpAttack(session, ally, 0);
    moveFaceUpAttack(session, highTarget, 1);
    moveFaceUpAttack(session, endControlTarget, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(luFengCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === luFeng.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: 30, countLimit: undefined, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: 34, countLimit: 1, event: "summonProcedure", property: 263168, range: ["hand"], triggerEvent: undefined },
      { category: categoryDestroy, code: 1002, countLimit: 1, event: "quick", property: undefined, range: ["monsterZone"], triggerEvent: undefined },
      { category: categoryControl, code: eventPhaseEnd, countLimit: 1, event: "trigger", property: undefined, range: ["monsterZone"], triggerEvent: "phaseEnd" },
    ]);

    const quickDestroy = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === luFeng.uid && action.effectId === "lua-4-1002");
    expect(quickDestroy, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, quickDestroy!);
    expect(restoredOpen.session.state.effects.find((effect) => effect.code === effectCannotActivate && effect.sourceUid === luFeng.uid)).toMatchObject({
      code: effectCannotActivate,
      property: 67635200,
      sourceUid: luFeng.uid,
      targetRange: [1, 0],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === highTarget.uid)).toMatchObject({
      controller: 1,
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: luFeng.uid,
      reasonEffectId: 4,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === endControlTarget.uid)).toMatchObject({ controller: 1, location: "monsterZone" });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === highTarget.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: highTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: luFeng.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredPostDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), workspace, reader);
    expectCleanRestore(restoredPostDestroy);
    expectRestoredLegalActions(restoredPostDestroy, 0);
    changePhase(restoredPostDestroy, 0, "battle");
    changePhase(restoredPostDestroy, 0, "main2");
    changePhase(restoredPostDestroy, 0, "end");
    expect(restoredPostDestroy.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-4608", eventCode: eventPhaseEnd, eventName: "phaseEnd", player: 0, sourceUid: luFeng.uid, triggerBucket: "turnMandatory" },
    ]);

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredPostDestroy.session), workspace, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    const controlTrigger = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "activateTrigger" && action.uid === luFeng.uid && action.effectId === "lua-5-4608");
    expect(controlTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, controlTrigger!);

    const restoredEndChain = restoreDuelWithLuaScripts(serializeDuel(restoredEnd.session), workspace, reader);
    expectCleanRestore(restoredEndChain);
    expectRestoredLegalActions(restoredEndChain, 1);
    resolveRestoredChain(restoredEndChain);
    expect(restoredEndChain.session.state.cards.find((card) => card.uid === luFeng.uid)).toMatchObject({
      controller: 1,
      previousController: 0,
      location: "monsterZone",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: luFeng.uid,
      reasonEffectId: 5,
    });
    expect(restoredEndChain.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === luFeng.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: luFeng.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: luFeng.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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

function changePhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, phase: DuelSession["state"]["phase"]): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}
