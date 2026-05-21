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
const bergamotCode = "85967160";
const recoverSpellCode = "859671600";
const defenderCode = "859671601";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBergamotScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bergamotCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const racePlant = 0x400;

describe.skipIf(!hasUpstreamScripts || !hasBergamotScript)("Lua real script Aromage Bergamot recover pierce stat", () => {
  it("restores EVENT_RECOVER ATK/DEF boost and LP-gated Plant piercing battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${bergamotCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_PIERCE)");
    expect(script).toContain("return Duel.GetLP(tp)>Duel.GetLP(1-tp)");
    expect(script).toContain("e2:SetCode(EVENT_RECOVER)");
    expect(script).toContain("return ep==tp");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      { code: bergamotCode, name: "Aromage Bergamot", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, level: 6, attack: 2400, defense: 1800 },
      { code: recoverSpellCode, name: "Bergamot Fixture Recovery", kind: "spell", typeFlags: typeSpell },
      { code: defenderCode, name: "Bergamot Defense Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 2000 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${recoverSpellCode}.lua`) return recoverSpellScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 85967160, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bergamotCode, recoverSpellCode] }, 1: { main: [defenderCode] } });
    startDuel(session);
    const bergamot = requireCard(session, bergamotCode);
    const recoverSpell = requireCard(session, recoverSpellCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, bergamot, 0);
    moveDuelCard(session.state, recoverSpell.uid, "hand", 0);
    moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpDefense";
    defender.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bergamotCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(recoverSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const recover = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === recoverSpell.uid);
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, recover!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.players[0].lifePoints).toBe(8500);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints")).toEqual([
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: recoverSpell.uid,
        eventReasonEffectId: 3,
      },
    ]);
    expect(restoredOpen.session.state.pendingTriggers).toMatchObject([
      {
        effectId: "lua-2-1112",
        eventName: "recoveredLifePoints",
        sourceUid: bergamot.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const statTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === bergamot.uid);
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, statTrigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === bergamot.uid), restoredTrigger.session.state)).toBe(3400);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === bergamot.uid), restoredTrigger.session.state)).toBe(2800);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === bergamot.uid && [100, 104, 203].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      range: effect.range,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 203, range: ["monsterZone"], reset: undefined, targetRange: [4, 0], value: undefined },
      { code: 100, range: ["monsterZone"], reset: { flags: 1644106240 }, targetRange: undefined, value: 1000 },
      { code: 104, range: ["monsterZone"], reset: { flags: 1644106240 }, targetRange: undefined, value: 1000 },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === bergamot.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredBattleResponses(restoredBattle);
    expect(restoredBattle.session.state.battleDamage[1]).toBe(1400);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(6600);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: bergamot.uid,
        eventPlayer: 1,
        eventValue: 1400,
        eventReason: duelReason.battle,
        eventReasonCardUid: bergamot.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function recoverSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_RECOVER)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Duel.Recover(tp,500,REASON_EFFECT) end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
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
