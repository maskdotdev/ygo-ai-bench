import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const signalWarriorCode = "9634146";
const drawCode = "96341460";
const destroyCode = "96341461";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSignalWarriorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${signalWarriorCode}.lua`));
const counterSignal = 0x1148;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeField = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSignalWarriorScript)("Lua real script Signal Warrior counter SelectEffect", () => {
  it("restores Signal Counter costs into damage, draw, and destroy branches", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${signalWarriorCode}.lua`);
    expectScriptShape(script);

    const damage = createOpenState(workspace, 4, 1);
    const damageAction = findSignalIgnition(damage.restored, damage.signal.uid);
    applyRestored(damage.restored, damageAction);
    passRestoredChain(damage.restored);
    expect(getDuelCardCounter(findCard(damage.restored.session, damage.signal.uid), counterSignal)).toBe(0);
    expect(damage.restored.session.state.players[1].lifePoints).toBe(7200);
    expect(damage.restored.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: damage.signal.uid,
        eventReasonEffectId: 6,
      },
    ]);
    expect(damage.restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1], descriptions: [154146337], returned: 1 },
    ]);

    const draw = createOpenState(workspace, 7, 2);
    const drawAction = findSignalIgnition(draw.restored, draw.signal.uid);
    applyRestored(draw.restored, drawAction);
    passRestoredChain(draw.restored);
    expect(getDuelCardCounter(findCard(draw.restored.session, draw.signal.uid), counterSignal)).toBe(0);
    expect(draw.restored.session.state.cards.find((card) => card.code === drawCode)).toMatchObject({
      location: "hand",
      controller: 0,
      reasonPlayer: 0,
    });
    expect(draw.restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [154146337, 154146338], returned: 2 },
    ]);

    const destroy = createOpenState(workspace, 10, 3);
    const destroyAction = findSignalIgnition(destroy.restored, destroy.signal.uid);
    applyRestored(destroy.restored, destroyAction);
    passRestoredChain(destroy.restored);
    expect(getDuelCardCounter(findCard(destroy.restored.session, destroy.signal.uid), counterSignal)).toBe(0);
    expect(findCard(destroy.restored.session, destroy.signal.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: destroy.signal.uid,
      reasonEffectId: 6,
    });
    expect(findCard(destroy.restored.session, destroy.target.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(destroy.restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed").map((event) => event.eventCardUid)).toEqual([destroy.signal.uid]);
    expect(destroy.restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2, 3], descriptions: [154146337, 154146338, 154146339], returned: 3 },
    ]);
    expect(destroy.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Signal Warrior");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_SIGNAL)>0");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.IsCanRemoveCounter(tp,1,1,COUNTER_SIGNAL,4,REASON_COST)");
  expect(script).toContain("Duel.IsPlayerCanDraw(tp,1)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,1,COUNTER_SIGNAL,ct,REASON_COST)");
  expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
  expect(script).toContain("Duel.SetTargetParam(800)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,800)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,tp,0)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");
  expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
}

function createOpenState(workspace: ReturnType<typeof createUpstreamNodeWorkspace>, counterCount: number, branch: number) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === signalWarriorCode),
    { code: drawCode, name: "Signal Warrior Draw", kind: "spell", typeFlags: typeSpell | typeField },
    { code: destroyCode, name: "Signal Warrior Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 9634146 + branch, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [signalWarriorCode, drawCode] }, 1: { main: [destroyCode] } });
  startDuel(session);
  const signal = requireCard(session, signalWarriorCode);
  const target = requireCard(session, destroyCode);
  moveFaceUpAttack(session, signal, 0, 0);
  moveFaceUpAttack(session, target, 1, 0);
  expect(addDuelCardCounter(signal, counterSignal, counterCount)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(signalWarriorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
    promptOverrides: [{ api: "SelectEffect", player: 0, returned: branch }],
  });
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, signal, target };
}

function findSignalIgnition(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): Extract<DuelAction, { type: "activateEffect" }> {
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate): candidate is Extract<DuelAction, { type: "activateEffect" }> => candidate.type === "activateEffect" && candidate.uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  return action!;
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyRestored(restored, pass!);
  }
}
