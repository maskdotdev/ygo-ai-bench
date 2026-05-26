import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const magnoliaCode = "73167098";
const plantAllyCode = "731670980";
const recoverSpellCode = "731670981";
const humidWindsCode = "28265983";
const removeTargetCode = "731670982";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMagnoliaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${magnoliaCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setAroma = 0xc9;
const effectIndestructibleEffect = 41;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMagnoliaScript)("Lua real script Aromalilith Magnolia recover remove stat", () => {
  it("restores LP-gated Plant protection, PayLP Winds removal, and recovery-triggered Plant ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${magnoliaCode}.lua`);
    expectScriptShape(script);
    const source = magnoliaSource(workspace);
    const reader = createCardReader(cards(workspace));

    const restoredRecover = createRestoredMagnoliaField({ reader, source, workspace, includeRecoverSpell: true });
    expectCleanRestore(restoredRecover);
    expectRestoredLegalActions(restoredRecover, 0);
    const magnolia = requireCard(restoredRecover.session, magnoliaCode);
    const plantAlly = requireCard(restoredRecover.session, plantAllyCode);
    const recoverSpell = requireCard(restoredRecover.session, recoverSpellCode);
    expect(restoredRecover.session.state.cards.find((card) => card.uid === magnolia.uid)?.data.fusionRequiredMaterialPredicates).toEqual([{ setcode: setAroma }, { race: racePlant }]);
    expect(restoredRecover.session.state.effects.filter((effect) => effect.sourceUid === magnolia.uid && effect.code === effectIndestructibleEffect).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      valueDescriptor: effect.luaValueDescriptor,
    }))).toEqual([
      { code: effectIndestructibleEffect, event: "continuous", range: ["monsterZone"], sourceUid: magnolia.uid, targetRange: [4, 0], valueDescriptor: "indestructible:opponent" },
    ]);
    const protectedPlant = destroyDuelCard(restoredRecover.session.state, plantAlly.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(protectedPlant).toMatchObject({ uid: plantAlly.uid, location: "monsterZone", controller: 0 });

    const recover = getLuaRestoreLegalActions(restoredRecover, 0).find((action) =>
      action.type === "activateEffect" && action.uid === recoverSpell.uid
    );
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredRecover, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRecover, recover!);
    resolveRestoredChain(restoredRecover);
    expect(restoredRecover.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventValue: trigger.eventValue,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-1112", eventCode: 1112, eventName: "recoveredLifePoints", eventPlayer: 0, eventReason: duelReason.effect, eventReasonCardUid: recoverSpell.uid, eventReasonEffectId: 1, eventValue: 700, player: 0, sourceUid: magnolia.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredRecover.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const stat = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === magnolia.uid && action.effectId === "lua-5-1112"
    );
    expect(stat, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, stat!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(8700);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === magnolia.uid), restoredTrigger.session.state)).toBe(3300);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === plantAlly.uid), restoredTrigger.session.state)).toBe(1900);
    expect(restoredTrigger.session.state.effects.filter((effect) => [magnolia.uid, plantAlly.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: magnolia.uid, value: 700 },
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: plantAlly.uid, value: 700 },
    ]);

    const restoredRemove = createRestoredMagnoliaField({ reader, source, workspace, includeWinds: true });
    expectCleanRestore(restoredRemove);
    expectRestoredLegalActions(restoredRemove, 0);
    const removeMagnolia = requireCard(restoredRemove.session, magnoliaCode);
    const remove = getLuaRestoreLegalActions(restoredRemove, 0).find((action) =>
      action.type === "activateEffect" && action.uid === removeMagnolia.uid && action.effectId === "lua-3"
    );
    expect(remove, JSON.stringify(getLuaRestoreLegalActions(restoredRemove, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRemove, remove!);
    resolveRestoredChain(restoredRemove);
    const banished = restoredRemove.session.state.cards.filter((card) => card.location === "banished").map((card) => ({
      code: card.code,
      reason: card.reason,
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
      reasonPlayer: card.reasonPlayer,
    }));
    expect(banished).toEqual([
      { code: humidWindsCode, reason: duelReason.effect, reasonCardUid: removeMagnolia.uid, reasonEffectId: 3, reasonPlayer: 0 },
    ]);
    expect(restoredRemove.session.state.players[0].lifePoints).toBe(6000);
    expect(restoredRemove.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredMagnoliaField({
  includeRecoverSpell = false,
  includeWinds = false,
  reader,
  source,
  workspace,
}: {
  includeRecoverSpell?: boolean;
  includeWinds?: boolean;
  reader: ReturnType<typeof createCardReader>;
  source: ReturnType<typeof magnoliaSource>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const ownMain = [plantAllyCode, ...(includeRecoverSpell ? [recoverSpellCode] : []), ...(includeWinds ? [humidWindsCode] : [])];
  const opponentMain = includeWinds ? [removeTargetCode] : [];
  const session = createDuel({ seed: includeWinds ? 73167099 : 73167098, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: ownMain, extra: [magnoliaCode] }, 1: { main: opponentMain } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, magnoliaCode), 0, 0).summonType = "fusion";
  moveFaceUpAttack(session, requireCard(session, plantAllyCode), 0, 1);
  if (includeRecoverSpell) moveDuelCard(session.state, requireCard(session, recoverSpellCode).uid, "hand", 0);
  if (includeWinds) {
    moveFaceUpSpellTrap(session, requireCard(session, humidWindsCode), 0, 0);
    moveFaceUpAttack(session, requireCard(session, removeTargetCode), 1, 0);
  }
  session.state.players[1].lifePoints = 7000;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  for (const code of [magnoliaCode, ...(includeRecoverSpell ? [recoverSpellCode] : [])]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(includeRecoverSpell ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Aromalilith Magnolia");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_AROMA),aux.FilterBoolFunctionEx(Card.IsRace,RACE_PLANT))");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e1:SetValue(aux.indoval)");
  expect(script).toContain("Duel.GetLP(tp)> Duel.GetLP(1-tp)");
  expect(script).toContain("e2:SetCost(Cost.PayLP(2000))");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsCode,{28265983,92266279,15177750}),tp,LOCATION_ONFIELD,0,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToRemove,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,ct,ct,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e3:SetCode(EVENT_RECOVER)");
  expect(script).toContain("return ep==tp");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsRace,RACE_PLANT),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ev)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const magnolia = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === magnoliaCode);
  expect(magnolia).toBeDefined();
  return [
    magnolia!,
    { code: plantAllyCode, name: "Magnolia Plant Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: recoverSpellCode, name: "Magnolia Recovery Spell", kind: "spell", typeFlags: typeSpell },
    { code: humidWindsCode, name: "Humid Winds", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: removeTargetCode, name: "Magnolia Remove Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
  ];
}

function magnoliaSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${recoverSpellCode}.lua`) return recoverSpellScript();
      return workspace.readScript(name);
    },
  };
}

function recoverSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Duel.Recover(tp,700,REASON_EFFECT) end)
      c:RegisterEffect(e)
    end
  `;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
