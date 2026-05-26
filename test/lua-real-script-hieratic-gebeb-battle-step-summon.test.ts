import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const gebebCode = "78033100";
const hasGebebScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gebebCode}.lua`));
const normalDragonCode = "780331000";
const defenderCode = "780331001";
const typeMonster = 0x1;
const typeNormal = 0x10;
const raceDragon = 0x2000;
const setHieratic = 0x69;

describe.skipIf(!hasUpstreamScripts || !hasGebebScript)("Lua real script Hieratic Dragon of Gebeb battle step summon", () => {
  it("restores battle-destroying mandatory trigger into Dragon Normal SpecialSummonStep with zero stats", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gebebCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("e1:SetCondition(aux.bdogcon)");
    expect(script).toContain("e1:SetLabel(1)");
    expect(script).toContain("e2:SetCode(EVENT_RELEASE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(spfilter),tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummonStep(sc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE)");
    expect(script).toContain("Duel.SpecialSummonComplete()");

    const cards: DuelCardData[] = [
      { code: gebebCode, name: "Hieratic Dragon of Gebeb", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 4, attack: 1800, defense: 400, setcodes: [setHieratic] },
      { code: normalDragonCode, name: "Gebeb Fixture Dragon Normal", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceDragon, level: 6, attack: 2200, defense: 1800 },
      { code: defenderCode, name: "Gebeb Fixture Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 78033100, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gebebCode, normalDragonCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const gebeb = requireCard(session, gebebCode);
    const normalDragon = requireCard(session, normalDragonCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, gebeb.uid, "monsterZone", 0).position = "faceUpAttack";
    gebeb.faceUp = true;
    moveDuelCard(session.state, normalDragon.uid, "deck", 0);
    moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
    defender.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gebebCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === gebeb.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, attack!);

    passRestoredBattleUntil(restoredOpen, () => restoredOpen.session.state.pendingTriggers.some((trigger) => trigger.effectId === "lua-1-1139"));
    expect(restoredOpen.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: gebeb.uid,
    });
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        effectId: "lua-1-1139",
        eventCardUid: gebeb.uid,
        eventCode: 1139,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleDestroyed",
        eventPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonCardUid: gebeb.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: gebeb.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === gebeb.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const restoredSummoned = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredSummoned);
    expectRestoredLegalActions(restoredSummoned, restoredSummoned.session.state.waitingFor ?? restoredSummoned.session.state.turnPlayer);

    const summonedDragon = restoredSummoned.session.state.cards.find((card) => card.uid === normalDragon.uid);
    expect(summonedDragon).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: gebeb.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(summonedDragon, restoredSummoned.session.state)).toBe(0);
    expect(currentDefense(summonedDragon, restoredSummoned.session.state)).toBe(0);
    expect(restoredSummoned.session.state.effects.filter((effect) => effect.sourceUid === normalDragon.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 101, event: "continuous", reset: { flags: 33427456 }, value: 0 },
      { code: 105, event: "continuous", reset: { flags: 33427456 }, value: 0 },
    ]);
    expect(restoredSummoned.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed" || event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: defender.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: gebeb.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: normalDragon.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: gebeb.uid,
        eventReasonEffectId: 1,
        eventUids: [normalDragon.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passRestoredBattleUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      const player = restored.session.state.waitingFor;
      expect(player).toBeDefined();
      const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restored, pass!);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
