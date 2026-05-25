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
const beastRisingCode = "84962466";
const costBeastCode = "849624660";
const targetBeastWarriorCode = "849624661";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBeastRisingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${beastRisingCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const raceBeastWarrior = 0x8000;
const attributeEarth = 0x10;
const effectUpdateAttack = 100;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBeastRisingScript)("Lua real script Beast Rising banish race target stat", () => {
  it("restores face-up Beast banish cost label into targeted Beast-Warrior ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${beastRisingCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const beastRising = requireCard(restored.session, beastRisingCode);
    const costBeast = requireCard(restored.session, costBeastCode);
    const target = requireCard(restored.session, targetBeastWarriorCode);
    const boost = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === beastRising.uid && action.effectId === "lua-2-1002"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, boost!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === costBeast.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: beastRising.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(findCard(restored.session, target.uid), restored.session.state)).toBe(3000);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === target.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetEventStandard }, sourceUid: target.uid, value: 1400 },
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
      { eventName: "banished", eventCardUid: costBeast.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: beastRising.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "becameTarget", eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "deck", current: "monsterZone" },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const beastRising = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === beastRisingCode);
  expect(beastRising).toBeDefined();
  return [
    { ...beastRising!, kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: costBeastCode, name: "Beast Rising Cost Beast", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
    { code: targetBeastWarriorCode, name: "Beast Rising Beast-Warrior Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 84962466, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [beastRisingCode, costBeastCode, targetBeastWarriorCode] }, 1: { main: [] } });
  startDuel(session);
  const beastRising = requireCard(session, beastRisingCode);
  moveFaceUpSpellTrap(session, beastRising, 0, 0);
  moveFaceUpAttack(session, requireCard(session, costBeastCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, targetBeastWarriorCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(beastRisingCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Beast Rising");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.IsPhase(PHASE_DAMAGE) and Duel.IsDamageCalculated()");
  expect(script).toContain("c:IsRace(RACE_BEAST|RACE_BEASTWARRIOR) and c:IsFaceup() and c:IsAbleToRemoveAsCost() and c:GetTextAttack()>0");
  expect(script).toContain("Duel.IsExistingTarget(aux.FaceupFilter(Card.IsRace,RACE_BEAST|RACE_BEASTWARRIOR),tp,LOCATION_MZONE,0,1,c)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcostfilter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e:SetLabel(g:GetFirst():GetTextAttack())");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsRace,RACE_BEAST|RACE_BEASTWARRIOR),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("tc:IsRace(RACE_BEAST|RACE_BEASTWARRIOR)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
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
