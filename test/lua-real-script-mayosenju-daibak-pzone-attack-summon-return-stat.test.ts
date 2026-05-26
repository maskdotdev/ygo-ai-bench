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
const daibakCode = "93368494";
const yosenjuAllyCode = "933684940";
const opponentTargetCode = "933684941";
const offTargetCode = "933684942";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDaibakScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${daibakCode}.lua`));
const setYosenju = 0xb3;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceBeastWarrior = 0x400000;
const attributeWind = 0x10;
const effectUpdateAttack = 100;
const effectSpecialSummonCondition = 30;
const effectCannotDisableSpecialSummon = 27;
const phaseEndEventCode = 4608;

describe.skipIf(!hasUpstreamScripts || !hasDaibakScript)("Lua real script Mayosenju Daibak PZone attack summon return stat", () => {
  it("restores PZone attack boost, summon-success targeting, and sumreg End Phase return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${daibakCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const pzone = createRestoredPzoneAttackOpen({ reader, workspace });
    expectCleanRestore(pzone.restored);
    expectRestoredLegalActions(pzone.restored, 0);
    const attack = getLuaRestoreLegalActions(pzone.restored, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === pzone.ally.uid && action.targetUid === pzone.target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(pzone.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(pzone.restored, attack!);
    const boost = getLuaRestoreLegalActions(pzone.restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === pzone.daibak.uid && action.effectId === "lua-3-1130"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(pzone.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(pzone.restored, boost!);
    resolveRestoredChain(pzone.restored);
    expect(currentAttack(findCard(pzone.restored.session, pzone.ally.uid), pzone.restored.session.state)).toBe(2000);
    expect(pzone.restored.session.state.effects.filter((effect) =>
      effect.sourceUid === pzone.ally.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169408 }, sourceUid: pzone.ally.uid, value: 300 },
    ]);

    const summon = createRestoredSummonOpen({ reader, workspace });
    expectCleanRestore(summon.restored);
    expectRestoredLegalActions(summon.restored, 0);
    expect(summon.restored.session.state.effects.filter((effect) =>
      effect.sourceUid === summon.daibak.uid && [effectSpecialSummonCondition, effectCannotDisableSpecialSummon, phaseEndEventCode].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      id: effect.id,
      label: effect.label,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: effectSpecialSummonCondition, id: "lua-4-30", label: undefined, property: 263168, range: ["hand"], value: undefined },
      { code: effectCannotDisableSpecialSummon, id: "lua-5-27", label: undefined, property: 263168, range: ["hand"], value: undefined },
      { code: phaseEndEventCode, id: "lua-8-4608", label: undefined, property: undefined, range: ["monsterZone"], value: undefined },
    ]);
    const normalSummon = getLuaRestoreLegalActions(summon.restored, 0).find((action) =>
      action.type === "normalSummon" && action.uid === summon.daibak.uid
    );
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(summon.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summon.restored, normalSummon!);
    resolveRestoredChain(summon.restored);
    const bounce = getLuaRestoreLegalActions(summon.restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === summon.daibak.uid && action.effectId === "lua-6-1100"
    );
    expect(bounce, JSON.stringify(getLuaRestoreLegalActions(summon.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summon.restored, bounce!);
    expect(summon.restored.session.state.chain.map((link) => link.operationInfos)).toEqual([]);
    resolveRestoredChain(summon.restored);
    expect(findCard(summon.restored.session, summon.daibak.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summon.daibak.uid,
      reasonEffectId: 6,
    });
    expect(findCard(summon.restored.session, summon.target.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summon.daibak.uid,
      reasonEffectId: 6,
    });
    expect(findCard(summon.restored.session, summon.offTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(summon.restored.session.state.eventHistory.filter((event) =>
      ["becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: summon.daibak.uid, eventCode: 1028, eventName: "becameTarget", eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: summon.target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: summon.daibak.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: summon.daibak.uid, eventReasonEffectId: 6, eventReasonPlayer: 0 },
      { eventCardUid: summon.target.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: summon.daibak.uid, eventReasonEffectId: 6, eventReasonPlayer: 0 },
      { eventCardUid: summon.daibak.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: summon.daibak.uid, eventReasonEffectId: 6, eventReasonPlayer: 0 },
    ]);
    expect(summon.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const daibak = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === daibakCode);
  expect(daibak).toBeDefined();
  return [
    { ...daibak!, level: 4 },
    { code: yosenjuAllyCode, name: "Mayosenju Daibak Yosenju Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, level: 4, attack: 1700, defense: 1000, setcodes: [setYosenju] },
    { code: opponentTargetCode, name: "Mayosenju Daibak Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: offTargetCode, name: "Mayosenju Daibak Off Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, level: 4, attack: 900, defense: 1000 },
  ];
}

function createRestoredPzoneAttackOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  ally: DuelCardInstance;
  daibak: DuelCardInstance;
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  target: DuelCardInstance;
} {
  const session = createDuel({ seed: 93368494, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [daibakCode, yosenjuAllyCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  const daibak = requireCard(session, daibakCode);
  const ally = requireCard(session, yosenjuAllyCode);
  const target = requireCard(session, opponentTargetCode);
  movePzone(session, daibak, 0);
  moveFaceUpAttack(session, ally, 0, 0);
  moveFaceUpAttack(session, target, 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(daibakCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return { ally, daibak, restored: restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader), target };
}

function createRestoredSummonOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  daibak: DuelCardInstance;
  offTarget: DuelCardInstance;
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  target: DuelCardInstance;
} {
  const session = createDuel({ seed: 93368495, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [daibakCode] }, 1: { main: [opponentTargetCode, offTargetCode] } });
  startDuel(session);
  const daibak = requireCard(session, daibakCode);
  const target = requireCard(session, opponentTargetCode);
  const offTarget = requireCard(session, offTargetCode);
  moveDuelCard(session.state, daibak.uid, "hand", 0);
  moveFaceUpAttack(session, target, 1, 0);
  moveFaceUpAttack(session, offTarget, 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(daibakCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return { daibak, offTarget, restored: restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader), target };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Mayosenju Daibak");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return at:IsControler(tp) and at:IsSetCard(SET_YOSENJU)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(300)");
  expect(script).toContain("e3:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e3:SetValue(aux.penlimit)");
  expect(script).toContain("e4:SetCode(EFFECT_CANNOT_DISABLE_SPSUMMON)");
  expect(script).toContain("e5:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e5:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e6:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("local g=Duel.SelectTarget(tp,Card.IsAbleToHand,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,2,nil)");
  expect(script).toContain("local g=Duel.GetTargetCards(e)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("e7:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("return e:GetHandler():GetFlagEffect(id)~=0");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,e:GetHandler(),1,0,0)");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("ge1:SetOperation(aux.sumreg)");
  expect(script).toContain("Duel.RegisterEffect(ge1,0)");
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

function movePzone(session: DuelSession, card: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.sequence = sequence;
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
