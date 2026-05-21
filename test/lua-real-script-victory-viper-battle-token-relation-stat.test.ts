import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const viperCode = "93130021";
const tokenCode = "93130022";
const battleTargetCode = "931300210";
const spellTrapCode = "931300211";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasViperScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${viperCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typesToken = 0x4011;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasViperScript)("Lua real script Victory Viper battle token relation stat", () => {
  it("restores battle-destroying SelectOption token branch with owner-derived final stats and self-destroy relation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${viperCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,1),aux.Stringid(id,2),aux.Stringid(id,3))");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOKEN,nil,1,0,0)");
    expect(script).toContain("Duel.CreateToken(tp,id+1)");
    expect(script).toContain("c:CreateRelation(token,RESET_EVENT|RESETS_STANDARD)");
    expect(script).toContain("Duel.SpecialSummonStep(token,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e3:SetCode(EFFECT_CHANGE_LEVEL)");
    expect(script).toContain("e4:SetCode(EFFECT_CHANGE_RACE)");
    expect(script).toContain("e5:SetCode(EFFECT_CHANGE_ATTRIBUTE)");
    expect(script).toContain("e6:SetCode(EFFECT_SELF_DESTROY)");
    expect(script).toContain("return not e:GetOwner():IsRelateToCard(e:GetHandler())");
    expect(script).toContain("Duel.SpecialSummonComplete()");
    expect(["operationInfos", "category: 0x400", "category: 0x200", "applyLuaRestoreResponse"]).toEqual([
      "operationInfos",
      "category: 0x400",
      "category: 0x200",
      "applyLuaRestoreResponse",
    ]);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 93130021, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [viperCode, spellTrapCode] }, 1: { main: [battleTargetCode] } });
    startDuel(session);

    const viper = requireCard(session, viperCode);
    const battleTarget = requireCard(session, battleTargetCode);
    const spellTrap = requireCard(session, spellTrapCode);
    moveFaceUpAttack(session, viper, 0);
    moveFaceUpAttack(session, battleTarget, 1);
    moveDuelCard(session.state, spellTrap.uid, "spellTrapZone", 0).faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectOption", player: 0, returned: 2 }] });
    expect(host.loadCardScript(Number(viperCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === viper.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponses(session);
    expect(session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: viper.uid,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        effectId: "lua-1-1139",
        sourceUid: viper.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: viper.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventPlayer: 1,
        eventReasonPlayer: 0,
        eventReasonCardUid: viper.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === viper.uid);
    expect(trigger, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0, 1, 2], descriptions: [1490080337, 1490080338, 1490080339], returned: 2 },
    ]);
    expect(session.state.chain).toEqual([]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    const restoredViper = restoredResolved.session.state.cards.find((card) => card.uid === viper.uid)!;
    const token = restoredResolved.session.state.cards.find((card) => card.code === tokenCode);
    expect(token).toBeDefined();
    expect(token).toMatchObject({
      location: "monsterZone",
      controller: 0,
      owner: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: viper.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(token!, restoredResolved.session.state)).toBe(currentAttack(restoredViper, restoredResolved.session.state));
    expect(currentDefense(token!, restoredResolved.session.state)).toBe(currentDefense(restoredViper, restoredResolved.session.state));
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === token!.uid).map((effect) => effect.code ?? 0).sort((a, b) => a - b)).toEqual([102, 106, 122, 127, 131, 141]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["battleDestroyed", "specialSummoned"].includes(event.eventName))).toEqual([
      battleDestroyedEvent(battleTarget.uid, viper.uid),
      specialSummonedEvent(token!.uid, viper.uid),
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: viperCode, name: "Victory Viper XX03", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: tokenCode, name: "Option Token", kind: "monster", typeFlags: typesToken, race: raceMachine, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: battleTargetCode, name: "Victory Viper Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 500, defense: 500 },
    { code: spellTrapCode, name: "Victory Viper Spell Trap", kind: "spell", typeFlags: typeSpell },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
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

function battleDestroyedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "battleDestroyed",
    eventCode: 1140,
    eventCardUid: cardUid,
    eventReason: duelReason.battle | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}

function specialSummonedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "specialSummoned",
    eventCode: 1102,
    eventCardUid: cardUid,
    eventUids: [cardUid],
    eventReason: duelReason.summon | duelReason.specialSummon,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
  };
}
