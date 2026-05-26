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
const darkRebellionCode = "42160203";
const materialCode = "421602030";
const targetCode = "421602031";
const gatePendulumCode = "421602032";
const dragonPendulumCode = "421602033";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDarkRebellionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darkRebellionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const typePendulum = 0x1000000;
const raceDragon = 0x2000;
const attributeDark = 0x20;
const setSupremeKingGate = 0x10f8;
const setSupremeKingDragon = 0x20f8;
const effectUpdateAttack = 100;
const effectSetAttackFinal = 102;
const eventBattleConfirm = 1133;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasDarkRebellionScript)("Lua real script Supreme King Dark Rebellion battle detach extra summon stat", () => {
  it("restores battle-confirm detach stat swing and Battle Phase self-to-Extra Pendulum summons", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${darkRebellionCode}.lua`));
    const reader = createCardReader(cards());

    const battleSession = createBattleField({ reader, workspace });
    const darkRebellion = requireCard(battleSession, darkRebellionCode);
    const material = requireCard(battleSession, materialCode);
    const target = requireCard(battleSession, targetCode);
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(battleSession), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === darkRebellion.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passUntilPendingTrigger(restoredBattle, "battleConfirmed");
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventUids: trigger.eventUids,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1133", eventCardUid: darkRebellion.uid, eventCode: eventBattleConfirm, eventName: "battleConfirmed", eventUids: [darkRebellion.uid, target.uid], player: 0, sourceUid: darkRebellion.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredConfirm = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredConfirm);
    expectRestoredLegalActions(restoredConfirm, 0);
    const confirm = getLuaRestoreLegalActions(restoredConfirm, 0).find((action) => action.type === "activateTrigger" && action.uid === darkRebellion.uid && action.effectId === "lua-2-1133");
    expect(confirm, JSON.stringify(getLuaRestoreLegalActions(restoredConfirm, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredConfirm, confirm!);
    resolveRestoredChain(restoredConfirm);

    expect(restoredConfirm.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: darkRebellion.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredConfirm.session.state.cards.find((card) => card.uid === target.uid), restoredConfirm.session.state)).toBe(0);
    expect(currentAttack(restoredConfirm.session.state.cards.find((card) => card.uid === darkRebellion.uid), restoredConfirm.session.state)).toBe(4900);
    expect(restoredConfirm.session.state.effects.filter((effect) => [target.uid, darkRebellion.uid].includes(effect.sourceUid) && [effectSetAttackFinal, effectUpdateAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 0 },
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: darkRebellion.uid, value: 2400 },
    ]);
    expect(restoredConfirm.session.state.eventHistory.filter((event) => ["battleConfirmed", "detachedMaterial"].includes(event.eventName))).toEqual([
      {
        eventName: "battleConfirmed",
        eventCode: eventBattleConfirm,
        eventCardUid: darkRebellion.uid,
        eventUids: [darkRebellion.uid, target.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkRebellion.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredQuick = createQuickSummonField({ reader, workspace });
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quickSource = requireCard(restoredQuick.session, darkRebellionCode);
    const pendulums = [requireCard(restoredQuick.session, gatePendulumCode), requireCard(restoredQuick.session, dragonPendulumCode)];
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === quickSource.uid && action.effectId === "lua-3-1002");
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quick!);
    expect(restoredQuick.session.state.cards.find((card) => card.uid === quickSource.uid)).toMatchObject({
      location: "extraDeck",
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: quickSource.uid,
      reasonEffectId: 3,
    });

    const restoredQuickChain = restoreDuelWithLuaScripts(serializeDuel(restoredQuick.session), workspace, reader);
    expectCleanRestore(restoredQuickChain);
    resolveRestoredChain(restoredQuickChain);
    for (const pendulum of pendulums) {
      expect(restoredQuickChain.session.state.cards.find((card) => card.uid === pendulum.uid)).toMatchObject({
        location: "monsterZone",
        controller: 0,
        faceUp: true,
        position: "faceUpDefense",
        summonType: "special",
        reason: duelReason.summon | duelReason.specialSummon,
        reasonPlayer: 0,
        reasonCardUid: quickSource.uid,
        reasonEffectId: 3,
      });
    }
    expect(restoredQuickChain.session.state.eventHistory.filter((event) => ["sentToDeck", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      position: event.eventCurrentState?.position,
    }))).toEqual([
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: quickSource.uid, eventUids: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: quickSource.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "extraDeck", position: "faceDown" },
      { eventName: "specialSummoned", eventCode: eventSpecialSummonSuccess, eventCardUid: pendulums[0]!.uid, eventUids: [pendulums[0]!.uid, pendulums[1]!.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: quickSource.uid, eventReasonEffectId: 3, previous: "extraDeck", current: "monsterZone", position: "faceUpDefense" },
    ]);
    expect(restoredQuickChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: darkRebellionCode, name: "Supreme King Dragon Dark Rebellion", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz | typePendulum, race: raceDragon, attribute: attributeDark, level: 4, attack: 2500, defense: 2000 },
    { code: materialCode, name: "Dark Rebellion Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceDragon, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: targetCode, name: "Dark Rebellion Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 2400, defense: 1500 },
    { code: gatePendulumCode, name: "Supreme King Gate Extra Pendulum", kind: "extra", typeFlags: typeMonster | typeEffect | typePendulum, race: raceDragon, attribute: attributeDark, level: 4, attack: 1800, defense: 1200, setcodes: [setSupremeKingGate] },
    { code: dragonPendulumCode, name: "Supreme King Dragon Extra Pendulum", kind: "extra", typeFlags: typeMonster | typeEffect | typePendulum, race: raceDragon, attribute: attributeDark, level: 4, attack: 1900, defense: 1300, setcodes: [setSupremeKingDragon] },
  ];
}

function createBattleField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 42160203, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode], extra: [darkRebellionCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  const darkRebellion = requireCard(session, darkRebellionCode);
  const material = requireCard(session, materialCode);
  moveFaceUpAttack(session, darkRebellion, 0, 0);
  moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 0;
  darkRebellion.overlayUids.push(material.uid);
  moveFaceUpAttack(session, requireCard(session, targetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerScript(session, workspace);
  return session;
}

function createQuickSummonField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 42160204, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [darkRebellionCode, gatePendulumCode, dragonPendulumCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, darkRebellionCode), 0, 0);
  for (const code of [gatePendulumCode, dragonPendulumCode]) {
    const moved = moveDuelCard(session.state, requireCard(session, code).uid, "extraDeck", 0);
    moved.faceUp = true;
  }
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerScript(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Supreme King Dragon Dark Rebellion");
  expect(script).toContain("Xyz.AddProcedure(c,s.matfilter,4,2)");
  expect(script).toContain("return c:IsType(TYPE_PENDULUM,xyz,sumtype,tp) and c:IsAttribute(ATTRIBUTE_DARK,xyz,sumtype,tp)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_CONFIRM)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("local atk=tc:GetBaseAttack()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return Duel.IsBattlePhase()");
  expect(script).toContain("Duel.SendtoDeck(c,nil,SEQ_DECKTOP,REASON_COST)");
  expect(script).toContain("Duel.GetLocationCountFromEx(tp,tp,e:GetHandler())>0");
  expect(script).toContain("aux.CheckSummonGate(tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
}

function registerScript(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(darkRebellionCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function passUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, eventName: string): void {
  let guard = 0;
  while (!restored.session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
