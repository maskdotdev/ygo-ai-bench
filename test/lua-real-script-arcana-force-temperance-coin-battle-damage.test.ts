import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const temperanceCode = "60953118";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTemperanceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${temperanceCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryCoin = 0x1000000;
const eventPreDamageCalculate = 1134;
const effectChangeBattleDamage = 208;
const halfDamage = 0x80000001;

describe.skipIf(!hasUpstreamScripts || !hasTemperanceScript)("Lua real script Arcana Force Temperance coin battle damage", () => {
  it("restores summon coin registration into persistent battle-damage half effects", () => {
    const restored = summonAndResolveCoin(10);
    const temperance = requireCard(restored.session, temperanceCode);

    expect(restored.session.state.lastCoinResults).toEqual([1]);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === temperance.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: eventPreDamageCalculate, event: "quick", range: ["hand"], targetRange: undefined, value: undefined },
      { category: categoryCoin, code: 1100, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined, value: undefined },
      { category: categoryCoin, code: 1102, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined, value: undefined },
      { category: categoryCoin, code: 1101, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined, value: undefined },
      { category: undefined, code: effectChangeBattleDamage, event: "continuous", range: ["monsterZone"], targetRange: [1, 0], value: halfDamage },
      { category: undefined, code: effectChangeBattleDamage, event: "continuous", range: ["monsterZone"], targetRange: [0, 1], value: halfDamage },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["normalSummoned", "coinTossed"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: temperance.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: temperance.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function summonAndResolveCoin(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const script = workspace.readScript(`official/c${temperanceCode}.lua`);
  expectScriptShape(script);
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [temperanceCode] }, 1: { main: [] } });
  startDuel(session);

  const temperance = requireCard(session, temperanceCode);
  moveDuelCard(session.state, temperance.uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(temperanceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);
  const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === temperance.uid);
  expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
  applyRestored(restoredOpen, summon!);

  const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
  expectCleanRestore(restoredTrigger);
  expectRestoredLegalActions(restoredTrigger, 0);
  const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === temperance.uid);
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
  applyRestored(restoredTrigger, trigger!);
  passRestoredChain(restoredTrigger);
  return restoredTrigger;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force XIV - Temperance");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("return Duel.GetBattleDamage(tp)>0");
  expect(script).toContain("e1:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("s.arcanareg(c,Arcana.TossCoin(c,tp))");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
  expect(script).toContain("e1:SetValue(HALF_DAMAGE)");
  expect(script).toContain("e2:SetTargetRange(0,1)");
  expect(script).toContain("Arcana.RegisterCoinResult(c,coin)");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())==COIN_HEADS");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())==COIN_TAILS");
}

function cards(): DuelCardData[] {
  return [
    { code: temperanceCode, name: "Arcana Force XIV - Temperance", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 2400 },
  ];
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? 0;
    expectRestoredLegalActions(restored, player);
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}
