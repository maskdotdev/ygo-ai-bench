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
const pixiesCode = "49928686";
const enablerCode = "499286860";
const opponentCode = "499286861";
const highLevelCode = "499286862";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPixiesScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pixiesCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasPixiesScript)("Lua real script Spright Pixies procedure pre-calculation stat", () => {
  it("restores oath hand procedure and pre-damage SelfToGrave GetBattleMonster stat boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${pixiesCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(s.spconfilter,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("e2:SetRange(LOCATION_HAND|LOCATION_MZONE)");
    expect(script).toContain("e2:SetCost(Cost.SelfToGrave)");
    expect(script).toContain("local a,d=Duel.GetBattleMonster(tp)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(d:GetAttack())");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      { code: pixiesCode, name: "Spright Pixies", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 1400, defense: 1400 },
      { code: enablerCode, name: "Spright Pixies Level 2 Battler", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 1000, defense: 1000 },
      { code: opponentCode, name: "Spright Pixies Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1500 },
      { code: highLevelCode, name: "Spright Pixies High-Level Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };

    const blocked = createRestoredPixiesField({ reader, source, workspace, withLevelTwo: false });
    expectCleanRestore(blocked);
    expectRestoredLegalActions(blocked, 0);
    expect(getLuaRestoreLegalActions(blocked, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restoredProcedure = createRestoredPixiesField({ reader, source, workspace, withLevelTwo: true });
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const pixies = requireCard(restoredProcedure.session, pixiesCode);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === pixies.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === pixies.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restoredProcedure.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: pixies.uid,
        eventPreviousState: { location: "hand", controller: 0, sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { location: "monsterZone", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
      },
    ]);

    const restoredBattle = createRestoredPixiesField({ reader, source, workspace, withLevelTwo: true });
    expectCleanRestore(restoredBattle);
    const handPixies = requireCard(restoredBattle.session, pixiesCode);
    const enabler = requireCard(restoredBattle.session, enablerCode);
    const opponent = requireCard(restoredBattle.session, opponentCode);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === enabler.uid && action.targetUid === opponent.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    advanceToPixiesActivation(restoredBattle, handPixies.uid);
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    const pixiesAction = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateEffect" && action.uid === handPixies.uid);
    expect(pixiesAction, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, pixiesAction!);
    resolveRestoredChain(restoredBattle);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === handPixies.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: handPixies.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === enabler.uid), restoredBattle.session.state)).toBe(2800);
    expect(currentDefense(restoredBattle.session.state.cards.find((card) => card.uid === enabler.uid), restoredBattle.session.state)).toBe(2800);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === enabler.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792 }, value: 1800 },
      { code: 104, reset: { flags: 1107169792 }, value: 1800 },
    ]);

    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredDamage);
    expect(currentAttack(restoredDamage.session.state.cards.find((card) => card.uid === enabler.uid), restoredDamage.session.state)).toBe(2800);
    passRestoredBattleResponses(restoredDamage);
    expect(restoredDamage.session.state.battleDamage[1]).toBe(1000);
    expect(restoredDamage.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredDamage.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({ location: "graveyard", controller: 1 });
  });
});

function createRestoredPixiesField({
  reader,
  source,
  workspace,
  withLevelTwo,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  withLevelTwo: boolean;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: withLevelTwo ? 49928686 : 49928680, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [pixiesCode, enablerCode, highLevelCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  const pixies = requireCard(session, pixiesCode);
  const enabler = requireCard(session, enablerCode);
  const highLevel = requireCard(session, highLevelCode);
  const opponent = requireCard(session, opponentCode);
  moveDuelCard(session.state, pixies.uid, "hand", 0);
  moveFaceUpAttack(session, withLevelTwo ? enabler : highLevel, 0);
  moveFaceUpAttack(session, opponent, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(pixiesCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
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

function advanceToPixiesActivation(restored: ReturnType<typeof restoreDuelWithLuaScripts>, pixiesUid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === pixiesUid)) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
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
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
