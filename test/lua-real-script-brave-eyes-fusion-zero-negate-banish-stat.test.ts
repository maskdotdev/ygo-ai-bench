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
const braveEyesCode = "88305705";
const pendulumDragonMaterialCode = "883057050";
const warriorMaterialCode = "883057051";
const ownAllyCode = "883057052";
const zeroMonsterCode = "883057053";
const banishTargetCode = "883057054";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBraveEyesScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${braveEyesCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceDragon = 0x2000;
const attributeDark = 0x20;
const setPendulumDragon = 0x10f2;
const effectSetAttackFinal = 102;
const effectCannotAttack = 85;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBraveEyesScript)("Lua real script Brave-Eyes fusion zero negate banish stat", () => {
  it("restores Fusion summon ATK zeroing, chain-solving zero-ATK monster negate, attack lock, and Damage Step End banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${braveEyesCode}.lua`);
    expectScriptShape(script);
    const source = braveEyesSource(workspace);
    const reader = createCardReader(cards(workspace));

    const restoredOpen = createRestoredOpenField({ reader, source, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const braveEyes = requireCard(restoredOpen.session, braveEyesCode);
    const pendulumMaterial = requireCard(restoredOpen.session, pendulumDragonMaterialCode);
    const warriorMaterial = requireCard(restoredOpen.session, warriorMaterialCode);
    const ownAlly = requireCard(restoredOpen.session, ownAllyCode);
    const zeroMonster = requireCard(restoredOpen.session, zeroMonsterCode);
    const banishTarget = requireCard(restoredOpen.session, banishTargetCode);
    expect(braveEyes.data.fusionRequiredMaterialPredicates).toEqual([{ setcode: setPendulumDragon }, { race: raceWarrior }]);
    const fusionSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action): action is Extract<DuelAction, { type: "fusionSummon" }> =>
      action.type === "fusionSummon" && action.uid === braveEyes.uid && sameMembers(action.materialUids, [pendulumMaterial.uid, warriorMaterial.uid])
    );
    expect(fusionSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, fusionSummon!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === braveEyes.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [pendulumMaterial.uid, warriorMaterial.uid],
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-2-1102",
        eventCardUid: braveEyes.uid,
        eventCode: 1102,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: braveEyes.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const zeroAttack = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === braveEyes.uid && action.effectId === "lua-2-1102"
    );
    expect(zeroAttack, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, zeroAttack!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === zeroMonster.uid), restoredTrigger.session.state)).toBe(0);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === banishTarget.uid), restoredTrigger.session.state)).toBe(0);
    expect(restoredTrigger.session.state.effects.filter((effect) => [zeroMonster.uid, banishTarget.uid, braveEyes.uid].includes(effect.sourceUid) && [effectSetAttackFinal, effectCannotAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      label: effect.label,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, label: undefined, reset: { flags: 33427456 }, sourceUid: zeroMonster.uid, targetRange: undefined, value: 0 },
      { code: effectSetAttackFinal, label: undefined, reset: { flags: 33427456 }, sourceUid: banishTarget.uid, targetRange: undefined, value: 0 },
      { code: effectCannotAttack, label: restoredTrigger.session.state.cards.find((card) => card.uid === braveEyes.uid)?.fieldId, reset: { flags: 1073742336 }, sourceUid: braveEyes.uid, targetRange: [4, 0], value: undefined },
    ]);

    const restoredNegateOpen = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredNegateOpen);
    restoredNegateOpen.session.state.turnPlayer = 1;
    restoredNegateOpen.session.state.phase = "main1";
    restoredNegateOpen.session.state.waitingFor = 1;
    expectRestoredLegalActions(restoredNegateOpen, 1);
    const zeroMonsterEffect = getLuaRestoreLegalActions(restoredNegateOpen, 1).find((action) =>
      action.type === "activateEffect" && action.uid === zeroMonster.uid
    );
    expect(zeroMonsterEffect, JSON.stringify(getLuaRestoreLegalActions(restoredNegateOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredNegateOpen, zeroMonsterEffect!);
    resolveRestoredChain(restoredNegateOpen);
    expect(restoredNegateOpen.host.messages).not.toContain("brave eyes zero monster resolved");
    expect(restoredNegateOpen.session.state.eventHistory.filter((event) => ["chainSolving", "chainNegated", "chainDisabled"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "chainSolving", eventCode: 1020, eventCardUid: braveEyes.uid, eventPlayer: 0, eventReasonPlayer: 0, eventValue: 1, relatedEffectId: 2 },
      { eventName: "chainSolving", eventCode: 1020, eventCardUid: zeroMonster.uid, eventPlayer: 1, eventReasonPlayer: 1, eventValue: 1, relatedEffectId: 5 },
      { eventName: "chainNegated", eventCode: 1024, eventCardUid: undefined, eventPlayer: 1, eventReasonPlayer: 1, eventValue: 1, relatedEffectId: 5 },
      { eventName: "chainDisabled", eventCode: 1025, eventCardUid: undefined, eventPlayer: 1, eventReasonPlayer: 1, eventValue: 1, relatedEffectId: 5 },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredNegateOpen.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    expect(getLuaRestoreLegalActions(restoredBattle, 0).some((action) =>
      action.type === "declareAttack" && action.attackerUid === ownAlly.uid
    )).toBe(false);
    const braveAttack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === braveEyes.uid && action.targetUid === banishTarget.uid
    );
    expect(braveAttack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, braveAttack!);
    passRestoredBattleUntilPendingTrigger(restoredBattle);

    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1141", eventCardUid: braveEyes.uid, eventCode: 1141, eventName: "damageStepEnded", eventPlayer: 0, player: 0, sourceUid: braveEyes.uid, triggerBucket: "turnOptional" },
    ]);
    const restoredBanishTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredBanishTrigger);
    expectRestoredLegalActions(restoredBanishTrigger, 0);
    const banish = getLuaRestoreLegalActions(restoredBanishTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === braveEyes.uid && action.effectId === "lua-4-1141"
    );
    expect(banish, JSON.stringify(getLuaRestoreLegalActions(restoredBanishTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBanishTrigger, banish!);
    resolveRestoredChain(restoredBanishTrigger);

    expect(restoredBanishTrigger.session.state.cards.find((card) => card.uid === banishTarget.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: braveEyes.uid,
      reasonEffectId: 4,
    });
    expect(restoredBanishTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 3000 });
  });
});

function createRestoredOpenField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ReturnType<typeof braveEyesSource>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 88305705, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [pendulumDragonMaterialCode, warriorMaterialCode, ownAllyCode], extra: [braveEyesCode] },
    1: { main: [zeroMonsterCode, banishTargetCode] },
  });
  startDuel(session);
  for (const code of [pendulumDragonMaterialCode, warriorMaterialCode]) moveDuelCard(session.state, requireCard(session, code).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, ownAllyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, zeroMonsterCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, banishTargetCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  for (const code of [braveEyesCode, zeroMonsterCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Brave-Eyes Pendulum Dragon");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_PENDULUM_DRAGON),aux.FilterBoolFunctionEx(Card.IsRace,RACE_WARRIOR))");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():GetSummonType()==SUMMON_TYPE_FUSION");
  expect(script).toContain("Duel.GetMatchingGroup(s.atkfilter,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e2:SetLabel(c:GetFieldID())");
  expect(script).toContain("e2:SetReset(RESET_PHASE|PHASE_END)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
  expect(script).toContain("return re:IsMonsterEffect() and re:GetHandler():GetAttack()==0");
  expect(script).toContain("Duel.NegateEffect(ev)");
  expect(script).toContain("e3:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("return c==Duel.GetAttacker() and bc and c:IsStatus(STATUS_OPPO_BATTLE) and bc:IsOnField() and bc:IsRelateToBattle()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,e:GetLabelObject(),1,0,0)");
  expect(script).toContain("Duel.Remove(bc,POS_FACEUP,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const braveEyes = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === braveEyesCode);
  expect(braveEyes).toBeDefined();
  return [
    braveEyes!,
    { code: pendulumDragonMaterialCode, name: "Brave-Eyes Pendulum Dragon Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1800, defense: 1000, setcodes: [setPendulumDragon] },
    { code: warriorMaterialCode, name: "Brave-Eyes Warrior Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: ownAllyCode, name: "Brave-Eyes Own Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1900, defense: 1000 },
    { code: zeroMonsterCode, name: "Brave-Eyes Zero Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: banishTargetCode, name: "Brave-Eyes Banish Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
  ];
}

function braveEyesSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${zeroMonsterCode}.lua`) return zeroMonsterScript();
      return workspace.readScript(name);
    },
  };
}

function zeroMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function() Debug.Message("brave eyes zero monster resolved") end)
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

function passRestoredBattleUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((uid) => right.includes(uid));
}
