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
const rageCode = "40227329";
const costCode = "402273290";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRageScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rageCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setDd = 0xaf;
const effectDirectAttack = 74;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasRageScript)("Lua real script D/D/D Divine Zero King Rage option direct attack", () => {
  it("restores release-cost SelectOption direct attack into attack-announcement final ATK and damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rageCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 40227329, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rageCode, costCode] }, 1: { main: [] } });
    startDuel(session);

    const rage = requireCard(session, rageCode);
    const cost = requireCard(session, costCode);
    moveFaceUpAttack(session, rage, 0, 0);
    moveFaceUpAttack(session, cost, 0, 1);
    session.state.players[1].lifePoints = 3500;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const options = { promptOverrides: [{ api: "SelectOption" as const, player: 0 as const, returned: 0 }] };
    const host = createLuaScriptHost(session, workspace, options);
    expect(host.loadCardScript(Number(rageCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, options);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === rage.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 320, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: 1002, event: "ignition", range: ["hand"], triggerEvent: undefined },
      { category: undefined, code: 82, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: 335, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: 32, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: undefined, event: "ignition", range: ["monsterZone"], triggerEvent: undefined },
      { category: 2097152, code: 1130, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "attackDeclared" },
      { category: undefined, code: 201, event: "continuous", range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: 42, event: "continuous", range: ["monsterZone"], triggerEvent: undefined },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === rage.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions.flatMap((prompt) => prompt.api === "SelectOption" ? [{
      api: prompt.api,
      descriptions: prompt.descriptions,
      options: prompt.options,
      player: prompt.player,
      returned: prompt.returned,
    }] : [])).toEqual([{ api: "SelectOption", descriptions: [643637266, 643637267, 643637268], options: [0, 1, 2], player: 0, returned: 0 }]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: rage.uid,
      reasonEffectId: 6,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === rage.uid && effect.code === effectDirectAttack).map((effect) => ({
      code: effect.code,
      description: effect.description,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectDirectAttack, description: 3205, reset: { flags: 1107169792 }, sourceUid: rage.uid },
    ]);

    restoredOpen.session.state.phase = "battle";
    restoredOpen.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, options);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const directAttack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === rage.uid && action.directAttack
    );
    expect(directAttack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, directAttack!);
    const attackBoost = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === rage.uid && action.effectId === "lua-7-1130"
    );
    expect(attackBoost, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attackBoost!);
    resolveRestoredChain(restoredBattle);
    passRestoredBattle(restoredBattle);

    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === rage.uid), restoredBattle.session.state)).toBe(3500);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(0);
    expect(restoredBattle.session.state.battleDamage[1]).toBe(0);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === rage.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: rage.uid, value: 3500 },
    ]);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "beforeBattleDamage").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventCardUid: rage.uid, eventCode: 1136, eventName: "beforeBattleDamage", eventPlayer: 1, eventReason: duelReason.battle, eventReasonCardUid: rage.uid, eventReasonPlayer: 0, eventValue: 3500 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: rageCode, name: "Go! - D/D/D Divine Zero King Rage", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceFiend, attribute: attributeDark, setcodes: [setDd], level: 10, attack: 0, defense: 0, leftScale: 0, rightScale: 0 },
    { code: costCode, name: "Divine Zero King Rage Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, setcodes: [setDd], level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Go! - D/D/D Divine Zero King Rage");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_DAMAGE)");
  expect(script).toContain("e2:SetCode(EFFECT_NO_EFFECT_DAMAGE)");
  expect(script).toContain("e3:SetCode(EFFECT_SUMMON_PROC)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,nil,1,false,nil,e:GetHandler())");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,nil,1,1,false,nil,e:GetHandler())");
  expect(script).toContain("Duel.SelectOption(tp,table.unpack(dtab))+1");
  expect(script).toContain("e1:SetCode(EFFECT_DIRECT_ATTACK)");
  expect(script).toContain("e5:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return Duel.GetLP(1-tp)<=4000");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(lp)");
  expect(script).toContain("e6:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
  expect(script).toContain("e7:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player, sequence);
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
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
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

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
    resolveRestoredChain(restored);
  }
}
