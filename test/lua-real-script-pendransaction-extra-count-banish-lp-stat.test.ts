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
const pendransactionCode = "58720904";
const materialCode = "587209040";
const opponentTargetCode = "587209041";
const extraFillerCodes = Array.from({ length: 15 }, (_, index) => `5872091${String(index).padStart(2, "0")}`);
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPendransactionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pendransactionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceCyberse = 0x1000000;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
const effectCannotBeEffectTarget = 71;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPendransactionScript)("Lua real script Pendransaction extra count banish LP stat", () => {
  it("restores Extra Deck count branches into ATK gain, untargetability, banish, and LP set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${pendransactionCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredPendransactionField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const pendransaction = requireCard(restored.session, pendransactionCode);
    const material = requireCard(restored.session, materialCode);
    const opponentTarget = requireCard(restored.session, opponentTargetCode);
    expect(restored.session.state.cards.filter((card) => card.controller === 0 && card.location === "extraDeck")).toHaveLength(15);
    expect(restored.session.state.cards.filter((card) => card.controller === 1 && card.location === "extraDeck")).toHaveLength(0);

    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === pendransaction.uid && candidate.effectId === "lua-2"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: pendransaction.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === pendransaction.uid), restored.session.state)).toBe(3000);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === pendransaction.uid && [effectUpdateAttack, effectCannotBeEffectTarget].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, range: ["monsterZone"], reset: { flags: 1107235328, count: 2 }, sourceUid: pendransaction.uid, value: 1000 },
      { code: effectCannotBeEffectTarget, property: 0x20000, range: ["monsterZone"], reset: { flags: 1107235328, count: 2 }, sourceUid: pendransaction.uid, value: 1 },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: pendransaction.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.players[1].lifePoints).toBe(3000);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "breakEffect" || event.eventName === "banished").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: pendransaction.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: pendransaction.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: opponentTarget.uid, eventCode: 1011, eventName: "banished", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: pendransaction.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: pendransaction.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredPendransactionField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 58720904, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode], extra: [pendransactionCode, ...extraFillerCodes] }, 1: { main: [opponentTargetCode], extra: [] } });
  startDuel(session);
  const pendransaction = moveFaceUpAttack(session, requireCard(session, pendransactionCode), 0, 0);
  pendransaction.summonType = "xyz";
  attachOverlayMaterial(session, pendransaction, requireCard(session, materialCode));
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  session.state.players[1].lifePoints = 8000;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(pendransactionCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pendransaction");
  expect(script).toContain("Xyz.AddProcedure(c,nil,4,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_REMOVE)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_EXTRA,0)-Duel.GetFieldGroupCount(tp,0,LOCATION_EXTRA)>0");
  expect(script).toContain("EFFECT_UPDATE_ATTACK");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END,2)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("EFFECT_CANNOT_BE_EFFECT_TARGET");
  expect(script).toContain("EFFECT_FLAG_SINGLE_RANGE");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToRemove,tp,0,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("Duel.SetLP(1-tp,3000)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const pendransaction = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === pendransactionCode);
  expect(pendransaction).toBeDefined();
  return [
    pendransaction!,
    { code: materialCode, name: "Pendransaction Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTargetCode, name: "Pendransaction Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    ...extraFillerCodes.map((code, index) => ({ code, name: `Pendransaction Extra Filler ${index + 1}`, kind: "extra" as const, typeFlags: typeMonster | typeEffect | typeXyz, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 })),
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function attachOverlayMaterial(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance): void {
  const attached = moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller);
  attached.sequence = holder.overlayUids.length;
  holder.overlayUids.push(attached.uid);
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
