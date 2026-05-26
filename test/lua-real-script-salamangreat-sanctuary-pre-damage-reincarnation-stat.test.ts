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
const sanctuaryCode = "1295111";
const salamangreatLinkCode = "12951110";
const defenderCode = "12951111";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSanctuaryScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sanctuaryCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeField = 0x80000;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeEarth = 0x10;
const setSalamangreat = 0x119;
const effectSetAttackFinal = 102;
const eventPreDamageCalculate = 1134;
const eventRecover = 1112;
const eventLifePointCostPaid = 1201;

describe.skipIf(!hasUpstreamScripts || !hasSanctuaryScript)("Lua real script Salamangreat Sanctuary pre-damage reincarnation stat", () => {
  it("restores Field Spell grant metadata and pre-damage LP cost into final ATK zero recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sanctuaryCode}.lua`);
    expectSanctuaryScriptShape(script);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredBattle({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const sanctuary = requireCard(restoredOpen.session, sanctuaryCode);
    const link = requireCard(restoredOpen.session, salamangreatLinkCode);
    const defender = requireCard(restoredOpen.session, defenderCode);

    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === sanctuary.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      labelObjectId: effect.labelObjectId,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 1002, event: "ignition", labelObjectId: undefined, property: undefined, range: ["hand", "spellTrapZone"], targetRange: undefined, triggerEvent: undefined, value: undefined },
      { category: undefined, code: undefined, event: "continuous", labelObjectId: 2, property: undefined, range: ["spellTrapZone"], targetRange: [64, 0], triggerEvent: undefined, value: undefined },
      { category: undefined, code: 34, event: "summonProcedure", labelObjectId: undefined, property: 262272, range: ["extraDeck"], targetRange: undefined, triggerEvent: undefined, value: 1275068416 },
      { category: 3145728, code: eventPreDamageCalculate, event: "trigger", labelObjectId: undefined, property: 16, range: ["spellTrapZone"], targetRange: undefined, triggerEvent: "beforeDamageCalculation", value: undefined },
    ]);

    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === link.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passBattleUntilTrigger(restoredOpen);
    expect(restoredOpen.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventTriggerTiming: trigger.eventTriggerTiming,
      eventUids: trigger.eventUids,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-4-1134",
        eventCardUid: link.uid,
        eventCode: eventPreDamageCalculate,
        eventName: "beforeDamageCalculation",
        eventPlayer: 0,
        eventReason: 0,
        eventTriggerTiming: "when",
        eventUids: [link.uid, defender.uid],
        player: 0,
        sourceUid: sanctuary.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === sanctuary.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === link.uid), restoredTrigger.session.state)).toBe(0);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(8800);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: link.uid, value: 0 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["lifePointCostPaid", "becameTarget", "recoveredLifePoints"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "lifePointCostPaid", eventCode: eventLifePointCostPaid, eventCardUid: undefined, eventPlayer: 0, eventValue: 1000, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: sanctuary.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: link.uid, eventPlayer: undefined, eventValue: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, previous: "extraDeck", current: "monsterZone" },
      { eventName: "recoveredLifePoints", eventCode: eventRecover, eventCardUid: undefined, eventPlayer: 0, eventValue: 1800, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: sanctuary.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: undefined, current: undefined },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 1295111, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [sanctuaryCode], extra: [salamangreatLinkCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  const sanctuary = requireCard(session, sanctuaryCode);
  const link = requireCard(session, salamangreatLinkCode);
  const defender = requireCard(session, defenderCode);
  moveDuelCard(session.state, sanctuary.uid, "spellTrapZone", 0);
  sanctuary.faceUp = true;
  sanctuary.sequence = 5;
  moveFaceUpAttack(session, link, 0, 0);
  link.summonType = "link";
  link.summonTypeCode = 0x4c000000;
  moveFaceUpAttack(session, defender, 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(sanctuaryCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectSanctuaryScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("e2:SetRange(LOCATION_EXTRA)");
  expect(script).toContain("e2:SetValue(SUMMON_TYPE_LINK)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_GRANT)");
  expect(script).toContain("e3:SetRange(LOCATION_FZONE)");
  expect(script).toContain("return c:IsSetCard(SET_SALAMANGREAT) and c:IsLinkMonster() end");
  expect(script).toContain("e3:SetLabelObject(e2)");
  expect(script).toContain("Duel.GetLocationCountFromEx(tp,tp,c,lc)>0");
  expect(script).toContain("Duel.SendtoGrave(mg,REASON_MATERIAL|REASON_LINK)");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("e4:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_RECOVER)");
  expect(script).toContain("e4:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e4:SetCost(Cost.PayLP(1000))");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SetTargetParam(rec)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("Duel.Recover(tp,tc:GetBaseAttack(),REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: sanctuaryCode, name: "Salamangreat Sanctuary", kind: "spell", typeFlags: typeSpell | typeField, setcodes: [setSalamangreat] },
    { code: salamangreatLinkCode, name: "Salamangreat Sanctuary Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeFire, setcodes: [setSalamangreat], level: 2, attack: 1800, defense: 0, linkMarkers: 0x28, linkMaterialMin: 1, linkMaterialMax: 1 },
    { code: defenderCode, name: "Salamangreat Sanctuary Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    passBattle(restored);
  }
}

function passBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
