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
const prominenceCode = "89770167";
const lavalCostCode = "897701670";
const defenderCode = "897701671";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasProminenceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${prominenceCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setLaval = 0x39;
const raceWarrior = 0x1;
const racePyro = 0x80;
const attributeFire = 0x4;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const resetStandardDisablePhaseEnd = 1107235328;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasProminenceScript)("Lua real script Prominence Molten Swordsman banish cost stat", () => {
  it("restores Damage Step Laval banish cost into temporary self ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${prominenceCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredBattle({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const prominence = requireCard(restored.session, prominenceCode);
    const lavalCost = requireCard(restored.session, lavalCostCode);
    const defender = requireCard(restored.session, defenderCode);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === prominence.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: 1002, countLimit: 1, event: "quick", property: 16384, range: ["monsterZone"], sourceUid: prominence.uid },
    ]);

    const attack = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === prominence.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passUntilDamageResponse(restored, 0);

    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === prominence.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, lavalCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: prominence.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(findCard(restored.session, prominence.uid), restored.session.state)).toBe(2100);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === prominence.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardDisablePhaseEnd }, sourceUid: prominence.uid, value: 300 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["attackDeclared", "banished"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "monsterZone", eventCardUid: prominence.uid, eventCode: 1130, eventName: "attackDeclared", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", relatedEffectId: undefined },
      { current: "banished", eventCardUid: lavalCost.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: prominence.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", relatedEffectId: undefined },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const prominence = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === prominenceCode);
  expect(prominence).toBeDefined();
  return [
    prominence!,
    { code: lavalCostCode, name: "Prominence Laval Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setLaval], race: racePyro, attribute: attributeFire, level: 4, attack: 1200, defense: 200 },
    { code: defenderCode, name: "Prominence Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2300, defense: 1600 },
  ];
}

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 89770167, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [prominenceCode, lavalCostCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, prominenceCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, lavalCostCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(prominenceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Prominence, Molten Swordsman");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCountLimit(1)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("return c:IsSetCard(SET_LAVAL) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,e:GetHandler())");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(300)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function passUntilDamageResponse(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  let guard = 0;
  while (restored.session.state.waitingFor !== player || restored.session.state.battleStep !== "damage" || restored.session.state.battleWindow?.kind !== "beforeDamageCalculation") {
    expect(++guard).toBeLessThan(20);
    const actionPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, actionPlayer).find((action) => action.type === "passChain" || action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, actionPlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
