import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const compilerCode = "92327802";
const targetCode = "923278020";
const counterDefect = 0x43;
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCompilerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${compilerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeLight = 0x10;
const raceCyberse = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasCompilerScript)("Lua real script Defect Compiler counter stat", () => {
  it("restores damage conversion metadata and resolves counter-cost Cyberse ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${compilerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };
    const session = createDuel({ seed: 92327802, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [compilerCode, targetCode] }, 1: { main: [] } });
    startDuel(session);
    const compiler = requireCard(session, compilerCode);
    const target = requireCard(session, targetCode);
    const movedCompiler = moveDuelCard(session.state, compiler.uid, "monsterZone", 0);
    movedCompiler.faceUp = true;
    movedCompiler.position = "faceUpAttack";
    const movedTarget = moveDuelCard(session.state, target.uid, "monsterZone", 0);
    movedTarget.faceUp = true;
    movedTarget.position = "faceUpAttack";
    expect(addDuelCardCounter(movedCompiler, counterDefect, 1)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(compilerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const restoredCompiler = requireCard(restored.session, compilerCode);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === restoredCompiler.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { category: undefined, code: 65603, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: restoredCompiler.uid, targetRange: undefined },
      { category: undefined, code: 131139, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: restoredCompiler.uid, targetRange: undefined },
      { category: undefined, code: 82, event: "continuous", property: 2048, range: ["monsterZone"], sourceUid: restoredCompiler.uid, targetRange: [1, 0] },
      { category: undefined, code: 335, event: "continuous", property: 2048, range: ["monsterZone"], sourceUid: restoredCompiler.uid, targetRange: [1, 0] },
      { category: 2097152, code: 1002, event: "quick", property: 16400, range: ["monsterZone"], sourceUid: restoredCompiler.uid, targetRange: undefined },
    ]);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === restoredCompiler.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, activate as DuelAction);
    expect(result.ok, result.error).toBe(true);
    expect(getDuelCardCounter(restored.session.state.cards.find((card) => card.uid === restoredCompiler.uid), counterDefect)).toBe(0);
    expect(currentAttack(restoredCompiler, restored.session.state)).toBe(1800);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === restoredCompiler.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 1107169792 }, value: 800 }]);
  });
});

function cards(): DuelCardData[] {
  return [
    cyberse(compilerCode, "Defect Compiler", 1000),
    cyberse(targetCode, "Defect Compiler Cyberse Target", 1000),
  ];
}

function cyberse(code: string, name: string, attack: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    race: raceCyberse,
    attribute: attributeLight,
    level: 3,
    attack,
    defense: 1000,
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Defect Compiler");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_DEFECT)");
  expect(script).toContain("c:SetCounterLimit(COUNTER_DEFECT,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_DAMAGE)");
  expect(script).toContain("e4:SetCode(EFFECT_NO_EFFECT_DAMAGE)");
  expect(script).toContain("Duel.IsCanRemoveCounter(tp,1,0,COUNTER_DEFECT,1,REASON_COST)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_DEFECT,1,REASON_COST)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(800)");
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
