import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const spiderCode = "81759748";
const insectTargetCode = "817597480";
const warriorDecoyCode = "817597481";
const levelZeroCode = "817597482";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSpiderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spiderCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceInsect = 0x800;
const attributeDark = 0x20;
const effectUpdateLevel = 130;
const effectFlagCannotDisable = 1024;
const effectFlagCardTarget = 16;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasSpiderScript)("Lua real script Dark Spider target level stat", () => {
  it("restores targeted Insect Level boost and excludes non-Insect and Level 0 decoys", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${spiderCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 81759748, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [spiderCode, insectTargetCode, warriorDecoyCode, levelZeroCode] }, 1: { main: [] } });
    startDuel(session);

    const spider = requireCard(session, spiderCode);
    const insectTarget = requireCard(session, insectTargetCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    const levelZero = requireCard(session, levelZeroCode);
    moveFaceUpAttack(session, spider, 0, 0);
    moveFaceUpAttack(session, insectTarget, 0, 1);
    moveFaceUpAttack(session, warriorDecoy, 0, 2);
    moveFaceUpAttack(session, levelZero, 0, 3);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(spiderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === spider.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"], sourceUid: spider.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === spider.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(currentLevel(restored.session.state.cards.find((card) => card.uid === spider.uid), restored.session.state)).toBe(4);
    expect(currentLevel(restored.session.state.cards.find((card) => card.uid === insectTarget.uid), restored.session.state)).toBe(3);
    expect(currentLevel(restored.session.state.cards.find((card) => card.uid === warriorDecoy.uid), restored.session.state)).toBe(3);
    expect(currentLevel(restored.session.state.cards.find((card) => card.uid === levelZero.uid), restored.session.state)).toBe(0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === spider.uid && effect.code === effectUpdateLevel).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateLevel, property: effectFlagCannotDisable, reset: { flags: resetStandardPhaseEnd }, sourceUid: spider.uid, value: 2 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: spider.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentLevel(restoredAfter.session.state.cards.find((card) => card.uid === spider.uid), restoredAfter.session.state)).toBe(4);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Dark Spider");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_INSECT) and c:IsLevelAbove(1)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LEVEL)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e1:SetValue(2)");
}

function cards(): DuelCardData[] {
  return [
    { code: spiderCode, name: "Dark Spider", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeDark, level: 2, attack: 0, defense: 0 },
    { code: insectTargetCode, name: "Dark Spider Insect Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeDark, level: 3, attack: 1000, defense: 1000 },
    { code: warriorDecoyCode, name: "Dark Spider Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 3, attack: 1300, defense: 1000 },
    { code: levelZeroCode, name: "Dark Spider Level Zero Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeDark, level: 0, attack: 900, defense: 900 },
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
