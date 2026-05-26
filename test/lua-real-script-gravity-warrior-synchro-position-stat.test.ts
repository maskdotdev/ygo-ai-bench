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
const gravityCode = "44035031";
const tunerCode = "440350310";
const nonTunerCode = "440350311";
const defenseTargetCode = "440350312";
const attackDecoyCode = "440350313";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGravityScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gravityCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const attributeEarth = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasGravityScript)("Lua real script Gravity Warrior Synchro position stat", () => {
  it("restores Synchro Summon ATK gain and opponent Battle Phase position quick effect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gravityCode}.lua`);
    expectGravityScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 44035031, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tunerCode, nonTunerCode], extra: [gravityCode] }, 1: { main: [defenseTargetCode, attackDecoyCode] } });
    startDuel(session);

    const gravity = requireCard(session, gravityCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    const defenseTarget = requireCard(session, defenseTargetCode);
    const attackDecoy = requireCard(session, attackDecoyCode);
    moveFaceUpAttack(session, tuner, 0, 0);
    moveFaceUpAttack(session, nonTuner, 0, 1);
    moveMonster(session, defenseTarget, 1, "faceUpDefense", 0);
    moveFaceUpAttack(session, attackDecoy, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gravityCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.cards.find((card) => card.uid === gravity.uid)?.data).toMatchObject({
      synchroTunerMin: 1,
      synchroTunerMax: 1,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 99,
    });
    expect(session.state.effects.filter((effect) => effect.sourceUid === gravity.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", luaConditionDescriptor: undefined, property: 263168, range: ["extraDeck"], triggerEvent: undefined, value: undefined },
      { category: 0x200000, code: 1102, event: "trigger", luaConditionDescriptor: "condition:source-summon-type:1174405120", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned", value: undefined },
      { category: 0x1000, code: 1002, event: "quick", luaConditionDescriptor: "condition:turn-player:opponent-battle-phase", property: 0x10, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const synchroAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "synchroSummon" &&
      action.uid === gravity.uid &&
      action.materialUids.includes(tuner.uid) &&
      action.materialUids.includes(nonTuner.uid)
    );
    expect(synchroAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, synchroAction!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === gravity.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, nonTuner.uid],
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: gravity.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === gravity.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(trigger).not.toHaveProperty("operationInfos");
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === gravity.uid), restoredTrigger.session.state)).toBe(2700);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === gravity.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 33492992 }, value: 600 }]);

    restoredTrigger.session.state.phase = "battle";
    restoredTrigger.session.state.turnPlayer = 1;
    restoredTrigger.session.state.waitingFor = 0;
    const restoredBattleOpen = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattleOpen);
    expectRestoredLegalActions(restoredBattleOpen, 0);
    const quickPosition = getLuaRestoreLegalActions(restoredBattleOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === gravity.uid
    );
    expect(quickPosition, JSON.stringify(getLuaRestoreLegalActions(restoredBattleOpen, 0), null, 2)).toBeDefined();
    if (!quickPosition || quickPosition.type !== "activateEffect") throw new Error("Expected Gravity Warrior quick position action");
    applyRestoredActionAndAssert(restoredBattleOpen, quickPosition!);
    const quickEffectNumericId = Number(quickPosition.effectId.split("-")[1]);
    expect(restoredBattleOpen.session.state.chain).toEqual([]);

    expect(restoredBattleOpen.session.state.cards.find((card) => card.uid === defenseTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceUpAttack",
    });
    expect(restoredBattleOpen.session.state.cards.find((card) => card.uid === attackDecoy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceUpAttack",
    });
    expect(restoredBattleOpen.session.state.effects.filter((effect) => effect.sourceUid === defenseTarget.uid && effect.code === 191).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
    }))).toEqual([{ code: 191, reset: { flags: 1073742336 } }]);
    const targetEventChainId = restoredBattleOpen.session.state.eventHistory.find((event) => event.eventName === "becameTarget" && event.eventCardUid === defenseTarget.uid)?.eventChainLinkId;
    expect(restoredBattleOpen.session.state.eventHistory.filter((event) => ["becameTarget", "positionChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: defenseTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: quickEffectNumericId,
        eventChainDepth: 1,
        eventChainLinkId: targetEventChainId,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: defenseTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gravity.uid,
        eventReasonEffectId: quickEffectNumericId,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredMustAttack = restoreDuelWithLuaScripts(serializeDuel(restoredBattleOpen.session), workspace, reader);
    expectCleanRestore(restoredMustAttack);
    restoredMustAttack.session.state.waitingFor = 1;
    expectRestoredLegalActions(restoredMustAttack, 1);
    const opponentActions = getLuaRestoreLegalActions(restoredMustAttack, 1);
    expect(opponentActions.some((action) => action.type === "declareAttack" && action.attackerUid === defenseTarget.uid && action.targetUid === gravity.uid)).toBe(true);
    expect(opponentActions.some((action) => action.type === "changePhase")).toBe(false);
    expect(opponentActions.some((action) => action.type === "endTurn")).toBe(false);
    expect(restoredMustAttack.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: gravityCode, name: "Gravity Warrior", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeEarth, level: 6, attack: 2100, defense: 1000 },
    { code: tunerCode, name: "Gravity Warrior Level 2 Tuner", kind: "monster", typeFlags: typeMonster | typeTuner, race: raceWarrior, attribute: attributeEarth, level: 2, attack: 800, defense: 800 },
    { code: nonTunerCode, name: "Gravity Warrior Level 4 Non-Tuner", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1200 },
    { code: defenseTargetCode, name: "Gravity Warrior Defense Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1800 },
    { code: attackDecoyCode, name: "Gravity Warrior Attack Decoy", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
  ];
}

function expectGravityScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_TRIGGER_F+EFFECT_TYPE_SINGLE)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsSynchroSummoned()");
  expect(script).toContain("Duel.GetMatchingGroupCount(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*300)");
  expect(script).toContain("e2:SetCategory(CATEGORY_POSITION)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("return Duel.IsTurnPlayer(1-tp) and Duel.IsBattlePhase()");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsDefensePos,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsDefensePos,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,g,#g,0,0)");
  expect(script).toContain("Duel.ChangePosition(tc,POS_FACEUP_ATTACK)");
  expect(script).toContain("e1:SetCode(EFFECT_MUST_ATTACK)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  moveMonster(session, card, player, "faceUpAttack", sequence);
}

function moveMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, position: "faceUpAttack" | "faceUpDefense", sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = position;
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
