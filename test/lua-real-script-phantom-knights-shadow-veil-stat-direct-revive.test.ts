import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack, currentDefense, currentRace } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const shadowVeilCode = "77462146";
const targetCode = "774621460";
const attackerCode = "774621461";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasShadowVeilScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${shadowVeilCode}.lua`));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const effectLeaveFieldRedirect = 60;
const resetEventStandard = 33427456;
const resetRedirect = 209326080;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasShadowVeilScript)("Lua real script The Phantom Knights of Shadow Veil stat direct revive", () => {
  it("restores target ATK/DEF boost and opponent direct-attack grave self-summon redirect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${shadowVeilCode}.lua`));
    const databaseShadowVeil = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === shadowVeilCode);
    expect(databaseShadowVeil).toBeDefined();
    const reader = createCardReader([
      databaseShadowVeil!,
      ...cards(),
    ]);

    const restoredStat = createRestoredShadowVeilField({ reader, workspace, scenario: "stat" });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statVeil = requireCard(restoredStat.session, shadowVeilCode);
    const target = requireCard(restoredStat.session, targetCode);
    const activation = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === statVeil.uid && action.effectId === "lua-1-1002"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, activation!);
    resolveRestoredChain(restoredStat);

    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(2100);
    expect(currentDefense(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(1300);
    expect(restoredStat.session.state.effects.filter((effect) => effect.sourceUid === target.uid && (effect.code === effectUpdateAttack || effect.code === effectUpdateDefense)).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, registryKey: `lua:${shadowVeilCode}:lua-3-100`, reset: { flags: resetEventStandard }, sourceUid: target.uid, value: 300 },
      { code: effectUpdateDefense, registryKey: `lua:${shadowVeilCode}:lua-4-104`, reset: { flags: resetEventStandard }, sourceUid: target.uid, value: 300 },
    ]);
    expect(restoredStat.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, previous: "deck", current: "monsterZone" },
    ]);

    const restoredAttackOpen = createRestoredShadowVeilField({ reader, workspace, scenario: "directAttack" });
    expectCleanRestore(restoredAttackOpen);
    expectRestoredLegalActions(restoredAttackOpen, 1);
    const graveVeil = requireCard(restoredAttackOpen.session, shadowVeilCode);
    const attacker = requireCard(restoredAttackOpen.session, attackerCode);
    const attack = getLuaRestoreLegalActions(restoredAttackOpen, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === undefined
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttackOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackOpen, attack!);
    expect(restoredAttackOpen.session.state.pendingTriggers).toEqual([]);
    expect(restoredAttackOpen.session.state.eventHistory.filter((event) => event.eventName === "attackDeclared").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: attacker.uid, eventCode: 1130, eventName: "attackDeclared", eventReason: 0, eventReasonPlayer: 1, previous: "deck", current: "monsterZone" },
    ]);
    expectRestoredLegalActions(restoredAttackOpen, 0);
    expect(getLuaRestoreLegalActions(restoredAttackOpen, 0).map((action) => ({
      effectId: action.type === "activateEffect" ? action.effectId : undefined,
      type: action.type,
      uid: action.type === "activateEffect" ? action.uid : undefined,
      windowKind: action.windowKind,
    }))).toEqual([
      { effectId: "lua-2-1130", type: "activateEffect", uid: graveVeil.uid, windowKind: "battle" },
      { effectId: undefined, type: "passAttack", uid: undefined, windowKind: "battle" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttackOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveVeil.uid && action.effectId === "lua-2-1130"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    const summonedVeil = restoredTrigger.session.state.cards.find((card) => card.uid === graveVeil.uid);
    expect(summonedVeil).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: graveVeil.uid,
      reasonEffectId: 2,
      data: {
        attack: 0,
        defense: 300,
        level: 4,
        attribute: attributeDark,
      },
    });
    expect(cardTypeFlags(summonedVeil, restoredTrigger.session.state)).toBe(typeMonster | typeNormal);
    expect(currentRace(summonedVeil, restoredTrigger.session.state)).toBe(raceWarrior);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === graveVeil.uid && effect.code === effectLeaveFieldRedirect).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: effectLeaveFieldRedirect,
        description: 3300,
        property: 67109888,
        range: ["monsterZone"],
        reset: { flags: resetRedirect },
        sourceUid: graveVeil.uid,
        value: 0x20,
      },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: attacker.uid, eventCode: 1130, eventName: "attackDeclared", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "deck", current: "monsterZone" },
      { eventCardUid: graveVeil.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: graveVeil.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard", current: "monsterZone" },
    ]);

    const restoredRedirect = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredRedirect);
    expectRestoredLegalActions(restoredRedirect, 0);
    destroyDuelCard(restoredRedirect.session.state, graveVeil.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredRedirect.session.state.cards.find((card) => card.uid === graveVeil.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect | duelReason.destroy | duelReason.redirect,
      reasonPlayer: 0,
    });
    expect(restoredRedirect.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredShadowVeilField({
  reader,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "stat" | "directAttack";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "stat" ? 77462146 : 77462147, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  if (scenario === "stat") {
    loadDecks(session, { 0: { main: [shadowVeilCode, targetCode] }, 1: { main: [] } });
  } else {
    loadDecks(session, { 0: { main: [shadowVeilCode] }, 1: { main: [attackerCode] } });
  }
  startDuel(session);
  if (scenario === "stat") {
    moveFaceDownTrap(session, requireCard(session, shadowVeilCode));
    moveFaceUpAttack(session, requireCard(session, targetCode), 0, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
  } else {
    moveDuelCard(session.state, requireCard(session, shadowVeilCode).uid, "graveyard", 0);
    moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;
  }
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(shadowVeilCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("The Phantom Knights of Shadow Veil");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.GetAttacker():IsControler(1-tp) and Duel.GetAttackTarget()==nil");
  expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,id,SET_THE_PHANTOM_KNIGHTS,TYPE_MONSTER|TYPE_NORMAL,0,300,4,RACE_WARRIOR,ATTRIBUTE_DARK)");
  expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,true,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetValue(LOCATION_REMOVED)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function cards(): DuelCardData[] {
  return [
    { code: targetCode, name: "Shadow Veil Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
    { code: attackerCode, name: "Shadow Veil Direct Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1900, defense: 1000 },
  ];
}

function moveFaceDownTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
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
