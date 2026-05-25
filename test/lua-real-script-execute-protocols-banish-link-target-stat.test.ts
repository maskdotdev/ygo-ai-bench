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
const executeCode = "20419926";
const borrelTargetCode = "204199260";
const darkLinkCostCode = "204199261";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasExecuteScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${executeCode}.lua`));
const setBorrel = 0x10f;
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceDragon = 0x2000;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasExecuteScript)("Lua real script Execute Protocols banish Link target stat", () => {
  it("restores Battle Phase Link banish cost label into targeted Borrel ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${executeCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const execute = requireCard(restored.session, executeCode);
    const borrelTarget = requireCard(restored.session, borrelTargetCode);
    const darkLinkCost = requireCard(restored.session, darkLinkCostCode);

    const boost = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === execute.uid && action.effectId === "lua-2-1002"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, boost!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === darkLinkCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost | duelReason.banish,
      reasonPlayer: 0,
      reasonCardUid: execute.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(findCard(restored.session, borrelTarget.uid), restored.session.state)).toBe(3800);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === borrelTarget.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: borrelTarget.uid, value: 1800 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCardUid: darkLinkCost.uid, eventReason: duelReason.cost | duelReason.banish, eventReasonPlayer: 0, eventReasonCardUid: execute.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
      { eventName: "becameTarget", eventCardUid: borrelTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "extraDeck", current: "monsterZone" },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const execute = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === executeCode);
  expect(execute).toBeDefined();
  return [
    { ...execute!, kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: borrelTargetCode, name: "Execute Protocols Borrel Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceDragon, attribute: attributeDark, level: 4, attack: 2000, defense: 0, setcodes: [setBorrel], linkMarkers: 0x3 },
    { code: darkLinkCostCode, name: "Execute Protocols DARK Link Cost", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceDragon, attribute: attributeDark, level: 2, attack: 1800, defense: 0, linkMarkers: 0x3 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 20419926, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [executeCode], extra: [borrelTargetCode, darkLinkCostCode] }, 1: { main: [] } });
  startDuel(session);
  const execute = requireCard(session, executeCode);
  const borrelTarget = requireCard(session, borrelTargetCode);
  const darkLinkCost = requireCard(session, darkLinkCostCode);
  moveFaceUpSpellTrap(session, execute, 0, 0);
  moveFaceUpAttack(session, borrelTarget, 0, 0);
  const cost = moveDuelCard(session.state, darkLinkCost.uid, "graveyard", 0);
  cost.faceUp = true;
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(executeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Execute Protocols");
  expect(script).toContain("s.listed_series={SET_BORREL}");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("return Duel.IsBattlePhase()");
  expect(script).toContain("return c:IsLinkMonster() and c:IsAttribute(ATTRIBUTE_DARK) and c:GetBaseAttack()>0");
  expect(script).toContain("and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true,false)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcfilter,tp,LOCATION_MZONE|LOCATION_HAND|LOCATION_GRAVE,0,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e:SetLabel(tc:GetBaseAttack())");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_BORREL) and c:IsMonster()");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
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
