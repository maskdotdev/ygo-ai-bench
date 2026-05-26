import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const finisherCode = "56292140";
const materialCode = "990562921";
const attackerCode = "990562922";
const opponentCardCode = "990562923";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasFinisherScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${finisherCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const counterFinisher = 0x40;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasFinisherScript)("Lua real script Number 51 counter destroy", () => {
  it("restores damage-step-end detach counter gain and battle phase three-counter field destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${finisherCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredCounter = createRestoredBattleState(reader, workspace, 0);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 1);
    const finisher = requireCard(restoredCounter.session, finisherCode);
    const attacker = requireCard(restoredCounter.session, attackerCode);
    const material = requireCard(restoredCounter.session, materialCode);
    attackAndReachDamageEnd(restoredCounter, 1, attacker.uid, finisher.uid);
    const counterTrigger = getLuaRestoreLegalActions(restoredCounter, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === finisher.uid && action.effectId?.endsWith("-1141")
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, counterTrigger!);
    resolveRestoredChain(restoredCounter);
    expect(findCard(restoredCounter.session, material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: finisher.uid,
      reasonEffectId: 5,
    });
    expect(getDuelCardCounter(findCard(restoredCounter.session, finisher.uid), counterFinisher)).toBe(1);
    expect(restoredCounter.session.state.eventHistory.filter((event) => ["damageStepEnded", "detachedMaterial", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "damageStepEnded", eventCode: 1141, eventCardUid: attacker.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: finisher.uid, eventReasonEffectId: 5 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: finisher.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: finisher.uid, eventReasonEffectId: 5 },
    ]);

    const restoredDestroy = createRestoredBattleState(reader, workspace, 3);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 1);
    const destroyFinisher = requireCard(restoredDestroy.session, finisherCode);
    const destroyAttacker = requireCard(restoredDestroy.session, attackerCode);
    const opponentCard = requireCard(restoredDestroy.session, opponentCardCode);
    attackAndReachDamageEnd(restoredDestroy, 1, destroyAttacker.uid, destroyFinisher.uid);
    declineRestoredTrigger(restoredDestroy, 0);
    finishBattle(restoredDestroy);
    const destroyTrigger = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === destroyFinisher.uid && action.effectId?.endsWith("-4224")
    );
    expect(destroyTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroyTrigger!);
    resolveRestoredChain(restoredDestroy);
    for (const card of [destroyAttacker, opponentCard]) {
      expect(findCard(restoredDestroy.session, card.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: destroyFinisher.uid,
        reasonEffectId: 6,
      });
    }
  });
});

function createRestoredBattleState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  counters: number,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 56292140 + counters, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode], extra: [finisherCode] }, 1: { main: [attackerCode, opponentCardCode] } });
  startDuel(session);
  const finisher = moveFaceUpAttack(session, requireCard(session, finisherCode), 0, 0);
  finisher.summonType = "xyz";
  markProcedureComplete(finisher);
  const material = moveDuelCard(session.state, requireCard(session, materialCode).uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
  material.sequence = 0;
  finisher.overlayUids.push(material.uid);
  if (counters > 0) expect(addDuelCardCounter(finisher, counterFinisher, counters)).toBe(true);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentCardCode), 1, 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  registerFinisher(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const finisher = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === finisherCode);
  expect(finisher).toBeDefined();
  return [
    finisher!,
    { code: materialCode, name: "Number 51 Material", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 3, attack: 1000, defense: 1000 },
    { code: attackerCode, name: "Number 51 Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3000, defense: 1000 },
    { code: opponentCardCode, name: "Number 51 Opponent Card", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
  ];
}

function registerFinisher(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(finisherCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Number 51: Finisher the Strong Arm");
  expect(script).toContain("c:EnableCounterPermit(0x40)");
  expect(script).toContain("Xyz.AddProcedure(c,nil,3,3)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("e2:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("e:GetHandler():AddCounter(0x40,1)");
  expect(script).toContain("e3:SetCategory(CATEGORY_DESTROY)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE|PHASE_BATTLE)");
  expect(script).toContain("return e:GetHandler():GetBattledGroupCount()>0 and e:GetHandler():GetCounter(0x40)==3");
  expect(script).toContain("Duel.GetMatchingGroup(aux.TRUE,tp,0,LOCATION_ONFIELD,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function attackAndReachDamageEnd(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, attackerUid: string, targetUid: string): void {
  const attack = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
  passUntilDamageEndTrigger(restored);
}

function passUntilDamageEndTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.phase === "battle" && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passDamage" || action.type === "passAttack");
    if (pass) {
      applyRestoredActionAndAssert(restored, pass);
      continue;
    }
    const main2 = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, main2!);
  }
}

function declineRestoredTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const decline = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "declineTrigger");
  expect(decline, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, decline!);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
