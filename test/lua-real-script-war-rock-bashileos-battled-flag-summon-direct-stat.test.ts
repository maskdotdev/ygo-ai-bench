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
const bashileosCode = "18558867";
const warRockAllyCode = "185588670";
const earthWarriorCode = "185588671";
const defenderCode = "185588672";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBashileosScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bashileosCode}.lua`));
const setWarRock = 0x161;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectDirectAttack = 74;
const effectLeaveFieldRedirect = 60;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasBashileosScript)("Lua real script War Rock Bashileos battled flag summon direct stat", () => {
  it("restores battled Earth Warrior flags into direct attack and War Rock boosts, plus battle-destroyed self summon redirect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${bashileosCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredBattle = createRestoredBashileosField({ reader, workspace, scenario: "battle" });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const fieldBashileos = requireCard(restoredBattle.session, bashileosCode);
    const ally = requireCard(restoredBattle.session, warRockAllyCode);
    const defender = requireCard(restoredBattle.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === ally.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passBattleUntilComplete(restoredBattle);
    expect(restoredBattle.session.state.flagEffects).toEqual([
      expect.objectContaining({ ownerType: "player", ownerId: "0", code: Number(bashileosCode), value: 0 }),
    ]);

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldBashileos.uid && action.effectId.startsWith("lua-1")
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quick!);
    resolveRestoredChain(restoredQuick);

    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === fieldBashileos.uid), restoredQuick.session.state)).toBe(2900);
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === ally.uid), restoredQuick.session.state)).toBe(1800);
    expect(restoredQuick.session.state.effects.filter((effect) => [fieldBashileos.uid, ally.uid].includes(effect.sourceUid ?? "") && [effectDirectAttack, effectUpdateAttack].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectDirectAttack, event: "continuous", property: 0x4000000, range: ["monsterZone"], reset: { flags: 1107235328 }, sourceUid: fieldBashileos.uid, value: undefined },
      { code: effectUpdateAttack, event: "continuous", property: 0x400, range: ["monsterZone"], reset: { flags: 1644040704 }, sourceUid: fieldBashileos.uid, value: 200 },
      { code: effectUpdateAttack, event: "continuous", property: 0x400, range: ["monsterZone"], reset: { flags: 1644040704 }, sourceUid: ally.uid, value: 200 },
    ]);
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["afterDamageCalculation", "battleDamageDealt", "battleDestroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
    }))).toEqual([
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: ally.uid, eventPlayer: 1, eventValue: 400, eventReason: duelReason.battle, eventReasonPlayer: 0, eventReasonCardUid: ally.uid },
      { eventName: "afterDamageCalculation", eventCode: 1138, eventCardUid: ally.uid, eventPlayer: undefined, eventValue: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined },
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: defender.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: ally.uid },
    ]);
    expect(restoredQuick.session.state.battleDamage).toEqual({ 0: 0, 1: 400 });

    const restoredSummon = createRestoredBashileosField({ reader, workspace, scenario: "summon" });
    expectCleanRestore(restoredSummon);
    const handBashileos = requireCard(restoredSummon.session, bashileosCode);
    const destroyedEarth = requireCard(restoredSummon.session, earthWarriorCode);
    const battleDestroyer = requireCard(restoredSummon.session, defenderCode);
    const destroyAttack = getLuaRestoreLegalActions(restoredSummon, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === battleDestroyer.uid && action.targetUid === destroyedEarth.uid
    );
    expect(destroyAttack, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, destroyAttack!);
    passBattleUntilComplete(restoredSummon);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const summon = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === handBashileos.uid && action.effectId === "lua-2-1140"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, summon!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === handBashileos.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handBashileos.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === handBashileos.uid && effect.code === effectLeaveFieldRedirect).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectLeaveFieldRedirect, property: 0x4000400, range: ["monsterZone"], reset: { flags: 209326080 }, value: 0x20 },
    ]);

    const restoredRedirect = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredRedirect);
    destroyDuelCard(restoredRedirect.session.state, handBashileos.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredRedirect.session.state.cards.find((card) => card.uid === handBashileos.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect | duelReason.destroy | duelReason.redirect,
      reasonPlayer: 1,
    });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: bashileosCode, name: "War Rock Bashileos", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWarRock], race: raceWarrior, attribute: attributeEarth, level: 8, attack: 2700, defense: 2700 },
    { code: warRockAllyCode, name: "War Rock Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWarRock], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: earthWarriorCode, name: "Earth Warrior Destroyed", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: defenderCode, name: "War Rock Battle Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
  ];
}

function createRestoredBashileosField({
  reader,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "battle" | "summon";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "battle" ? 18558867 : 18558868, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [bashileosCode, warRockAllyCode, earthWarriorCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  if (scenario === "battle") {
    moveFaceUpAttack(session, requireCard(session, bashileosCode), 0, 0);
    moveFaceUpAttack(session, requireCard(session, warRockAllyCode), 0, 1);
    moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
    session.state.phase = "battle";
  } else {
    moveDuelCard(session.state, requireCard(session, bashileosCode).uid, "hand", 0);
    moveFaceUpAttack(session, requireCard(session, earthWarriorCode), 0, 0);
    moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bashileosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  }
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(bashileosCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("War Rock Bashileos");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetCode(EVENT_BATTLED)");
  expect(script).toContain("Duel.IsDamageCalculated()");
  expect(script).toContain("Duel.GetBattleMonster(0)");
  expect(script).toContain("Duel.RegisterFlagEffect(bc0:GetControler(),id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("return Duel.IsBattlePhase() and Duel.GetFlagEffect(tp,id)>0");
  expect(script).toContain("aux.StatChangeDamageStepCondition()");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_WAR_ROCK),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_DIRECT_ATTACK)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_WAR_ROCK),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e2:SetReset(RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("c:IsRace(RACE_WARRIOR) and c:IsAttribute(ATTRIBUTE_EARTH) and c:IsPreviousControler(tp)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence = 0): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passBattleUntilComplete(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
