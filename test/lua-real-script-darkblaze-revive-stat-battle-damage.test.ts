import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const darkblazeCode = "39343610";
const hasDarkblazeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darkblazeCode}.lua`));
const reviverCode = "393436100";
const targetCode = "393436101";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasDarkblazeScript)("Lua real script Darkblaze revive stat battle damage", () => {
  it("restores Graveyard Special Summon stat doubling into battle-destroying target-parameter damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${darkblazeCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_GRAVE)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(c:GetBaseAttack()*2)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetValue(c:GetBaseDefense()*2)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("local bc=c:GetBattleTarget()");
    expect(script).toContain("Duel.SetTargetParam(dam)");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: darkblazeCode, name: "Darkblaze Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 1200, defense: 1000 },
      { code: reviverCode, name: "Darkblaze Fixture Reviver", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: targetCode, name: "Darkblaze Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 39343610, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkblazeCode, reviverCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const darkblaze = requireCard(session, darkblazeCode);
    const reviver = requireCard(session, reviverCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, darkblaze.uid, "graveyard", 0);
    moveDuelCard(session.state, reviver.uid, "monsterZone", 0).position = "faceUpAttack";
    reviver.faceUp = true;
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    target.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${reviverCode}.lua`) return reviverScript(darkblazeCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkblazeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(reviverCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const revive = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === reviver.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, revive!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === darkblaze.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: reviver.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        player: 0,
        effectId: "lua-1-1102",
        sourceUid: darkblaze.uid,
        triggerBucket: "turnMandatory",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: darkblaze.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: reviver.uid,
        eventReasonEffectId: 3,
        eventTriggerTiming: "when",
        eventUids: [darkblaze.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredStatTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredStatTrigger);
    expectRestoredLegalActions(restoredStatTrigger, 0);
    const statTrigger = getLuaRestoreLegalActions(restoredStatTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === darkblaze.uid);
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredStatTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStatTrigger, statTrigger!);
    expect(restoredStatTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    const restoredDarkblaze = restoredStatTrigger.session.state.cards.find((card) => card.uid === darkblaze.uid);
    expect(currentAttack(restoredDarkblaze, restoredStatTrigger.session.state)).toBe(2400);
    expect(currentDefense(restoredDarkblaze, restoredStatTrigger.session.state)).toBe(2000);

    restoredStatTrigger.session.state.phase = "battle";
    restoredStatTrigger.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredStatTrigger.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === darkblaze.uid && action.targetUid === target.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passBattleUntilTrigger(restoredBattle);

    expect(restoredBattle.session.state.players[1]!.lifePoints).toBe(6500);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: darkblaze.uid,
    });
    expect(restoredBattle.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-11-1",
        player: 0,
        effectId: "lua-2-1139",
        sourceUid: darkblaze.uid,
        triggerBucket: "turnMandatory",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: darkblaze.uid,
        eventPlayer: 1,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkblaze.uid,
        eventReasonEffectId: 3,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredDamageTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredDamageTrigger);
    expectRestoredLegalActions(restoredDamageTrigger, 0);
    const damageTrigger = getLuaRestoreLegalActions(restoredDamageTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === darkblaze.uid);
    expect(damageTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDamageTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDamageTrigger, damageTrigger!);
    expect(restoredDamageTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredDamageTrigger.session.state.players[1]!.lifePoints).toBe(5600);
    expect(restoredDamageTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === darkblaze.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: darkblaze.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: reviver.uid,
        eventReasonEffectId: 3,
        eventUids: [darkblaze.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    expect(restoredDamageTrigger.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 900,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkblaze.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function reviverScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(Card.IsCode,tp,LOCATION_GRAVE,0,nil,${targetCode})
        if tc then Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
