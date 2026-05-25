import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const tuningCode = "78845026";
const targetCode = "788450260";
const tunerDecoyCode = "788450261";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTuningScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tuningCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const raceThunder = 0x1000;
const attributeLight = 0x10;
const effectAddType = 115;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTuningScript)("Lua real script Lightwave Tuning add Tuner type", () => {
  it("restores targeted Level 4 LIGHT non-Tuner into added Tuner type", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tuningCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const tuning = requireCard(restored.session, tuningCode);
    const target = requireCard(restored.session, targetCode);
    const tunerDecoy = requireCard(restored.session, tunerDecoyCode);
    expect(cardTypeFlags(target, restored.session.state) & typeTuner).toBe(0);
    expect(cardTypeFlags(tunerDecoy, restored.session.state) & typeTuner).toBe(typeTuner);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === tuning.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(cardTypeFlags(findCard(restored.session, target.uid), restored.session.state) & typeTuner).toBe(typeTuner);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === target.uid && effect.code === effectAddType
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectAddType, reset: { flags: resetEventStandard }, sourceUid: target.uid, value: typeTuner },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
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
      { eventName: "becameTarget", eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previous: "deck", current: "monsterZone" },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const tuning = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === tuningCode);
  expect(tuning).toBeDefined();
  return [
    { ...tuning!, kind: "spell", typeFlags: typeSpell },
    { code: targetCode, name: "Lightwave Tuning LIGHT Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: tunerDecoyCode, name: "Lightwave Tuning Tuner Decoy", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceThunder, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 78845026, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tuningCode, targetCode, tunerDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, tuningCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, targetCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, tunerDecoyCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(tuningCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Lightwave Tuning");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsFaceup() and c:GetLevel()==4 and c:IsAttribute(ATTRIBUTE_LIGHT) and not c:IsType(TYPE_TUNER)");
  expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_ADD_TYPE)");
  expect(script).toContain("e1:SetValue(TYPE_TUNER)");
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

function moveFaceDownSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
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
