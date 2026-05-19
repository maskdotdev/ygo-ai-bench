import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const dogCode = "12076263";
const soldierCode = "12299841";
const hasWindUpScripts = [dogCode, soldierCode].every((code) => fs.existsSync(path.join(upstreamRoot, "script", "official", `c${code}.lua`)));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasWindUpScripts)("Lua real script Wind-Up no-turn-reset stat ignition", () => {
  it("restores Wind-Up Dog and Soldier no-turn-reset ATK and Level ignition boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dogScript = workspace.readScript(`c${dogCode}.lua`);
    const soldierScript = workspace.readScript(`c${soldierCode}.lua`);
    for (const script of [dogScript, soldierScript]) {
      expect(script).toContain("e1:SetProperty(EFFECT_FLAG_NO_TURN_RESET)");
      expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
      expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
      expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
      expect(script).toContain("e1:SetCountLimit(1)");
      expect(script).toContain("c:IsFaceup() and c:IsRelateToEffect(e)");
      expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
      expect(script).toContain("e2:SetCode(EFFECT_UPDATE_LEVEL)");
      expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
      expect(script).toContain("e2:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
    }
    expect(dogScript).toContain("e1:SetValue(600)");
    expect(dogScript).toContain("e2:SetValue(2)");
    expect(soldierScript).toContain("e1:SetValue(400)");
    expect(soldierScript).toContain("e2:SetValue(1)");

    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [dogCode, soldierCode].includes(card.code));
    expect(cards.map((card) => card.code).sort()).toEqual([dogCode, soldierCode].sort());
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 12076263, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dogCode, soldierCode] }, 1: { main: [] } });
    startDuel(session);

    const dog = requireCard(session.state.cards, dogCode);
    const soldier = requireCard(session.state.cards, soldierCode);
    moveFaceUpAttack(session.state, dog.uid);
    moveFaceUpAttack(session.state, soldier.uid);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dogCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(soldierCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => [dog.uid, soldier.uid].includes(effect.sourceUid)).map((effect) => ({
      category: effect.category,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 0x200000, countLimit: 1, event: "ignition", id: "lua-1", property: 0x400000, range: ["monsterZone"], sourceUid: dog.uid },
      { category: 0x200000, countLimit: 1, event: "ignition", id: "lua-2", property: 0x400000, range: ["monsterZone"], sourceUid: soldier.uid },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    activateRestoredIgnition(restored, dog.uid);
    activateRestoredIgnition(restored, soldier.uid);

    expectStatLine(restored.session.state, dog.uid, (dog.data.attack ?? 0) + 600, (dog.data.level ?? 0) + 2);
    expectStatLine(restored.session.state, soldier.uid, (soldier.data.attack ?? 0) + 400, (soldier.data.level ?? 0) + 1);
    expect(restored.session.state.usedCountKeys).toEqual([
      `no-turn-reset:0:${dog.uid}:lua-1`,
      `no-turn-reset:0:${soldier.uid}:lua-2`,
    ]);
    expect(getLuaRestoreLegalActions(restored, 0).filter((action) => action.type === "activateEffect" && [dog.uid, soldier.uid].includes(action.uid))).toEqual([]);

    const restoredBoosts = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredBoosts);
    expectRestoredLegalActions(restoredBoosts, 0);
    expectStatLine(restoredBoosts.session.state, dog.uid, (dog.data.attack ?? 0) + 600, (dog.data.level ?? 0) + 2);
    expectStatLine(restoredBoosts.session.state, soldier.uid, (soldier.data.attack ?? 0) + 400, (soldier.data.level ?? 0) + 1);
    expect(getLuaRestoreLegalActions(restoredBoosts, 0).filter((action) => action.type === "activateEffect" && [dog.uid, soldier.uid].includes(action.uid))).toEqual([]);

    endTurn(restoredBoosts, 0);
    expectStatLine(restoredBoosts.session.state, dog.uid, dog.data.attack ?? 0, dog.data.level ?? 0);
    expectStatLine(restoredBoosts.session.state, soldier.uid, soldier.data.attack ?? 0, soldier.data.level ?? 0);

    const restoredNextTurn = restoreDuelWithLuaScripts(serializeDuel(restoredBoosts.session), workspace, reader);
    expectCleanRestore(restoredNextTurn);
    expect(restoredNextTurn.session.state.usedCountKeys).toEqual([
      `no-turn-reset:0:${dog.uid}:lua-1`,
      `no-turn-reset:0:${soldier.uid}:lua-2`,
    ]);
  });
});

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(state: ReturnType<typeof createDuel>["state"], uid: string): void {
  const card = moveDuelCard(state, uid, "monsterZone", 0);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function activateRestoredIgnition(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): void {
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}

function endTurn(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "endTurn");
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}

function expectStatLine(state: ReturnType<typeof createDuel>["state"], uid: string, attack: number, level: number): void {
  const card = state.cards.find((candidate) => candidate.uid === uid);
  expect(currentAttack(card, state)).toBe(attack);
  expect(currentLevel(card, state)).toBe(level);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
