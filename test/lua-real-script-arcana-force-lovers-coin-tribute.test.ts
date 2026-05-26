import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resetDuelActivityCounts } from "#duel/activity.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const loversCode = "97574404";
const tributeTargetCode = "975744040";
const tributeMaterialCode = "975744041";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLoversScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${loversCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setArcanaForce = 0x5;
const categoryCoin = 0x1000000;
const effectCannotSummon = 20;
const effectCannotMSet = 23;
const effectDoubleTribute = 150;

describe.skipIf(!hasUpstreamScripts || !hasLoversScript)("Lua real script Arcana Force Lovers coin tribute effects", () => {
  it("restores heads Arcana coin registration into double-tribute material support", () => {
    const restored = summonAndResolveCoin(10, 0);
    const lovers = requireCard(restored.session, loversCode);
    const tributeTarget = requireCard(restored.session, tributeTargetCode);
    resetDuelActivityCounts(restored.session.state, 0);

    expect(restored.session.state.lastCoinResults).toEqual([1]);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === lovers.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { category: categoryCoin, code: 1100, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined },
      { category: categoryCoin, code: 1102, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined },
      { category: categoryCoin, code: 1101, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined },
      { category: undefined, code: effectDoubleTribute, event: "continuous", range: ["monsterZone"], targetRange: undefined },
      { category: undefined, code: effectCannotSummon, event: "continuous", range: ["monsterZone"], targetRange: [1, 1] },
      { category: undefined, code: effectCannotMSet, event: "continuous", range: ["monsterZone"], targetRange: [1, 1] },
    ]);

    expectRestoredLegalActions(restored, 0);
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(actions.some((action) =>
      action.type === "tributeSummon" &&
      action.uid === tributeTarget.uid &&
      action.tributeUids.length === 1 &&
      action.tributeUids[0] === lovers.uid
    )).toBe(true);
    expect(restored.session.state.eventHistory.filter((event) => ["normalSummoned", "coinTossed"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: lovers.uid,
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
        eventReasonCardUid: lovers.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });

  it("restores tails Arcana coin registration into opponent tribute summon and set locks", () => {
    const restored = summonAndResolveCoin(1, 0);
    const tributeTarget = requireCard(restored.session, tributeTargetCode);
    const tributeMaterial = requireCard(restored.session, tributeMaterialCode);

    moveFaceUpAttack(restored.session, tributeMaterial, 1, 1);
    moveDuelCard(restored.session.state, tributeTarget.uid, "hand", 1);
    tributeTarget.sequence = 0;
    restored.session.state.turnPlayer = 1;
    restored.session.state.waitingFor = 1;
    expect(restored.session.state.lastCoinResults).toEqual([0]);

    const restoredOpponentOpen = restoreDuelWithLuaScripts(serializeDuel(restored.session), restored.workspace, restored.reader);
    expectCleanRestore(restoredOpponentOpen);
    expectRestoredLegalActions(restoredOpponentOpen, 1);
    const actions = getLuaRestoreLegalActions(restoredOpponentOpen, 1);
    expect(actions.some((action) =>
      action.type === "tributeSummon" &&
      action.uid === tributeTarget.uid &&
      action.tributeUids.includes(tributeMaterial.uid)
    )).toBe(false);
    expect(actions.some((action) =>
      action.type === "tributeSet" &&
      action.uid === tributeTarget.uid &&
      action.tributeUids.includes(tributeMaterial.uid)
    )).toBe(false);
  });
});

function summonAndResolveCoin(seed: number, player: PlayerId) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const script = workspace.readScript(`official/c${loversCode}.lua`);
  expectScriptShape(script);
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [loversCode, tributeTargetCode, tributeMaterialCode] }, 1: { main: [] } });
  startDuel(session);

  const lovers = requireCard(session, loversCode);
  const tributeTarget = requireCard(session, tributeTargetCode);
  const tributeMaterial = requireCard(session, tributeMaterialCode);
  moveDuelCard(session.state, lovers.uid, "hand", player);
  moveDuelCard(session.state, tributeTarget.uid, "hand", player);
  moveFaceUpAttack(session, tributeMaterial, player, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = player;
  session.state.waitingFor = player;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(loversCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, player);
  const summon = getLuaRestoreLegalActions(restoredOpen, player).find((action) => action.type === "normalSummon" && action.uid === lovers.uid);
  expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, player), null, 2)).toBeDefined();
  applyRestored(restoredOpen, summon!);

  const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
  expectCleanRestore(restoredTrigger);
  expectRestoredLegalActions(restoredTrigger, player);
  const trigger = getLuaRestoreLegalActions(restoredTrigger, player).find((action) => action.type === "activateTrigger" && action.uid === lovers.uid);
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, player), null, 2)).toBeDefined();
  applyRestored(restoredTrigger, trigger!);
  passRestoredChain(restoredTrigger);
  return { ...restoredTrigger, workspace, reader };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force VI - The Lovers");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("s.arcanareg(c,Arcana.TossCoin(c,tp))");
  expect(script).toContain("e1:SetCode(EFFECT_DOUBLE_TRIBUTE)");
  expect(script).toContain("return c:IsSetCard(SET_ARCANA_FORCE)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_SUMMON)");
  expect(script).toContain("e3:SetCode(EFFECT_CANNOT_MSET)");
  expect(script).toContain("Arcana.RegisterCoinResult(c,coin)");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())==COIN_HEADS");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())==COIN_TAILS");
  expect(script).toContain("return (sumtp&SUMMON_TYPE_TRIBUTE)==SUMMON_TYPE_TRIBUTE and c:IsSetCard(SET_ARCANA_FORCE)");
}

function cards(): DuelCardData[] {
  return [
    { code: loversCode, name: "Arcana Force VI - The Lovers", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArcanaForce], level: 4, attack: 1600, defense: 1600 },
    { code: tributeTargetCode, name: "Arcana Force Tribute Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArcanaForce], level: 7, attack: 2500, defense: 2000 },
    { code: tributeMaterialCode, name: "Arcana Force Tribute Material", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArcanaForce], level: 4, attack: 1000, defense: 1000 },
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
