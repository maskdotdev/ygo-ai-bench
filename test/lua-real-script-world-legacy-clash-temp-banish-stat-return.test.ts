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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const clashCode = "93236220";
const hasClashScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${clashCode}.lua`));
const banishCostCode = "932362200";
const statTargetCode = "932362201";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeQuickplay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasClashScript)("Lua real script World Legacy Clash temporary banish stat return", () => {
  it("restores banish-as-cost label state into stat reduction and End Phase ReturnToField", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${clashCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.Remove(rc,POS_FACEUP,REASON_COST+REASON_TEMPORARY)");
    expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("e1:SetOperation(s.retop)");
    expect(script).toContain("local rc=e:GetLabelObject()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("Duel.ReturnToField(e:GetLabelObject())");

    const cards: DuelCardData[] = [
      { code: clashCode, name: "World Legacy Clash", kind: "spell", typeFlags: typeSpell | typeQuickplay },
      { code: banishCostCode, name: "World Legacy Clash Cost Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 800 },
      { code: statTargetCode, name: "World Legacy Clash Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 93236220, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [clashCode, banishCostCode] }, 1: { main: [statTargetCode] } });
    startDuel(session);

    const clash = requireCard(session, clashCode);
    const costMonster = requireCard(session, banishCostCode);
    const target = requireCard(session, statTargetCode);
    moveDuelCard(session.state, clash.uid, "hand", 0);
    moveFaceUpAttack(session, costMonster, 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(clashCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === clash.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect("operationInfos" in activation! ? activation.operationInfos : []).toEqual([]);
    applyLuaRestoreAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === costMonster.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost | duelReason.temporary,
      reasonPlayer: 0,
      reasonCardUid: clash.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "banished")).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: costMonster.uid,
        eventReason: duelReason.cost | duelReason.temporary,
        eventReasonPlayer: 0,
        eventReasonCardUid: clash.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    resolveRestoredChain(restoredOpen);
    const restoredTarget = restoredOpen.session.state.cards.find((card) => card.uid === target.uid)!;
    expect(currentAttack(restoredTarget, restoredOpen.session.state)).toBe(800);
    expect(currentDefense(restoredTarget, restoredOpen.session.state)).toBe(800);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", value: -1200 },
      { code: 104, event: "continuous", value: -800 },
    ]);

    const restoredAfterStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAfterStat);
    expectRestoredLegalActions(restoredAfterStat, 0);
    expect(restoredAfterStat.session.state.effects.find((effect) => effect.registryKey === "lua:93236220:lua-2-4608")).toMatchObject({
      registryKey: "lua:93236220:lua-2-4608",
      triggerEvent: "phaseEnd",
      labelObjectUid: costMonster.uid,
    });
    expect(currentAttack(restoredAfterStat.session.state.cards.find((card) => card.uid === target.uid), restoredAfterStat.session.state)).toBe(800);
    expect(currentDefense(restoredAfterStat.session.state.cards.find((card) => card.uid === target.uid), restoredAfterStat.session.state)).toBe(800);
    expect(restoredAfterStat.session.state.cards.find((card) => card.uid === costMonster.uid)).toMatchObject({ location: "banished", controller: 0 });

    restoredAfterStat.session.state.phase = "main2";
    restoredAfterStat.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredAfterStat, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredAfterStat, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredAfterStat, endPhase!);

    expect(restoredAfterStat.session.state.cards.find((card) => card.uid === costMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: clash.uid,
      reasonEffectId: 2,
    });
    expect(restoredAfterStat.session.state.eventHistory.filter((event) => event.eventCardUid === costMonster.uid && event.eventName === "moved" && event.eventCurrentState?.location === "monsterZone")).toEqual([
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: costMonster.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: clash.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const restoredAfterReturn = restoreDuelWithLuaScripts(serializeDuel(restoredAfterStat.session), workspace, reader);
    expectCleanRestore(restoredAfterReturn);
    expectRestoredLegalActions(restoredAfterReturn, 0);
    expect(restoredAfterReturn.session.state.cards.find((card) => card.uid === costMonster.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
