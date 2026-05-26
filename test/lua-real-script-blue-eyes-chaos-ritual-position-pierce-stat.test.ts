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
const chaosCode = "20654247";
const blueEyesCode = "89631139";
const attackTargetCode = "206542470";
const setTargetCode = "206542471";
const targeterCode = "206542472";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasChaosScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chaosCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeRitual = 0x80;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasChaosScript)("Lua real script Blue-Eyes Chaos ritual position pierce stat", () => {
  it("runs material check after Ritual Summon and restores attack-announced position/stat wipe plus piercing grant", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chaosCode}.lua`);
    expectBlueEyesChaosScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 20654247, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chaosCode, blueEyesCode] }, 1: { main: [attackTargetCode, setTargetCode, targeterCode] } });
    startDuel(session);

    const chaos = requireCard(session, chaosCode);
    const blueEyes = requireCard(session, blueEyesCode);
    const attackTarget = requireCard(session, attackTargetCode);
    const setTarget = requireCard(session, setTargetCode);
    const targeter = requireCard(session, targeterCode);
    moveDuelCard(session.state, chaos.uid, "hand", 0);
    moveDuelCard(session.state, blueEyes.uid, "hand", 0);
    moveFaceUpAttack(session, attackTarget, 1, 0);
    moveFaceDownDefense(session, setTarget, 1, 1);
    moveDuelCard(session.state, targeter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chaosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === chaos.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      valuePredicate: typeof effect.valuePredicate,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["hand"], triggerEvent: undefined, valuePredicate: "undefined" },
      { category: undefined, code: 30, event: "continuous", property: 263168, range: ["hand"], triggerEvent: undefined, valuePredicate: "function" },
      { category: undefined, code: 71, event: "continuous", property: 131072, range: ["monsterZone"], triggerEvent: undefined, valuePredicate: "function" },
      { category: undefined, code: 41, event: "continuous", property: 131072, range: ["monsterZone"], triggerEvent: undefined, valuePredicate: "function" },
      { category: 0x201000, code: 1130, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "attackDeclared", valuePredicate: "undefined" },
      { category: undefined, code: 251, event: "continuous", property: undefined, range: ["hand"], triggerEvent: undefined, valuePredicate: "function" },
    ]);

    const ritualResult = host.loadScript(ritualSummonScript(chaosCode, blueEyesCode), "blue-eyes-chaos-ritual-summon.lua");
    expect(ritualResult.ok, ritualResult.error).toBe(true);
    expect(host.messages).toContain("blue-eyes chaos ritual 1/1/true");
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(restoredBattle.host.loadScript(effectTargetProbe(chaosCode, targeterCode), "blue-eyes-chaos-target-probe.lua").ok).toBe(true);
    expect(restoredBattle.host.messages).toContain("blue-eyes chaos target protection false/true");
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === chaos.uid && action.targetUid === attackTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-5-1130",
        eventCardUid: chaos.uid,
        eventName: "attackDeclared",
        eventPlayer: 0,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.ritual,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: chaos.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === chaos.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === attackTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpDefense" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === setTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpAttack" });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === attackTarget.uid), restoredChain.session.state)).toBe(0);
    expect(currentDefense(restoredChain.session.state.cards.find((card) => card.uid === attackTarget.uid), restoredChain.session.state)).toBe(0);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === setTarget.uid), restoredChain.session.state)).toBe(0);
    expect(currentDefense(restoredChain.session.state.cards.find((card) => card.uid === setTarget.uid), restoredChain.session.state)).toBe(0);
    expect(restoredChain.session.state.effects.filter((effect) => [attackTarget.uid, setTarget.uid, chaos.uid].includes(effect.sourceUid) && [102, 106, 203].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 102, property: undefined, reset: { flags: 33427456 }, sourceUid: attackTarget.uid, value: 0 },
      { code: 106, property: undefined, reset: { flags: 33427456 }, sourceUid: attackTarget.uid, value: 0 },
      { code: 102, property: undefined, reset: { flags: 33427456 }, sourceUid: setTarget.uid, value: 0 },
      { code: 106, property: undefined, reset: { flags: 33427456 }, sourceUid: setTarget.uid, value: 0 },
      { code: 203, property: 67109888, reset: { flags: 1107169792 }, sourceUid: chaos.uid, value: undefined },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "positionChanged").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.position,
      current: event.eventCurrentState?.position,
    }))).toEqual([
      { eventCardUid: attackTarget.uid, eventReason: duelReason.effect, eventReasonCardUid: chaos.uid, eventReasonEffectId: 5, previous: "faceUpAttack", current: "faceUpDefense" },
      { eventCardUid: setTarget.uid, eventReason: duelReason.effect, eventReasonCardUid: chaos.uid, eventReasonEffectId: 5, previous: "faceDownDefense", current: "faceUpAttack" },
      { eventCardUid: attackTarget.uid, eventReason: 0, eventReasonCardUid: chaos.uid, eventReasonEffectId: 5, previous: "faceUpAttack", current: "faceUpDefense" },
    ]);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: chaosCode, name: "Blue-Eyes Chaos Dragon", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceDragon, attribute: attributeDark, level: 8, attack: 3000, defense: 0 },
    { code: blueEyesCode, name: "Blue-Eyes White Dragon", kind: "monster", typeFlags: typeMonster, race: raceDragon, attribute: attributeLight, level: 8, attack: 3000, defense: 2500 },
    { code: attackTargetCode, name: "Blue-Eyes Chaos Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2000, defense: 1500 },
    { code: setTargetCode, name: "Blue-Eyes Chaos Set Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1200 },
    { code: targeterCode, name: "Blue-Eyes Chaos Targeter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectBlueEyesChaosScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetValue(aux.ritlimit)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("e2:SetValue(aux.tgoval)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("return tp~=e:GetHandlerPlayer()");
  expect(script).toContain("e4:SetCategory(CATEGORY_POSITION+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e4:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return c:IsRitualSummoned() and c:GetFlagEffect(id)~=0");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsCanChangePosition,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.ChangePosition(tg,POS_FACEUP_DEFENSE,POS_FACEDOWN_DEFENSE,POS_FACEUP_ATTACK,POS_FACEUP_ATTACK)");
  expect(script).toContain("local og=Duel.GetOperatedGroup():Filter(Card.IsFaceup,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
  expect(script).toContain("e3:SetCode(EFFECT_PIERCE)");
  expect(script).toContain("e5:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("g:IsExists(Card.IsCode,1,nil,CARD_BLUEEYES_W_DRAGON)");
  expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD&~(RESET_TOFIELD|RESET_LEAVE|RESET_TEMP_REMOVE),0,1)");
}

function ritualSummonScript(targetCode: string, materialCode: string): string {
  return `
    local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_HAND,0,nil)
    local m=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${materialCode}),0,LOCATION_HAND,0,nil)
    local result=Duel.RitualSummon(c,Group.FromCards(m),false,POS_FACEUP_ATTACK)
    Debug.Message("blue-eyes chaos ritual " .. result .. "/" .. c:GetFlagEffect(${chaosCode}) .. "/" .. tostring(c:IsRitualSummoned()))
  `;
}

function effectTargetProbe(targetCode: string, opponentCode: string): string {
  return `
    local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,nil)
    local opponent=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${opponentCode}),1,LOCATION_HAND,0,nil)
    local opponent_effect=Effect.CreateEffect(opponent)
    local own_effect=Effect.CreateEffect(target)
    Debug.Message("blue-eyes chaos target protection " .. tostring(target:IsCanBeEffectTarget(opponent_effect)) .. "/" .. tostring(target:IsCanBeEffectTarget(own_effect)))
  `;
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

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDownDefense";
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = (restored.session.state.waitingFor ?? restored.session.state.turnPlayer) as PlayerId;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
