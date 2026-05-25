import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const coilCode = "53152590";
const ironChainTargetCode = "531525900";
const nonIronChainDecoyCode = "531525901";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCoilScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${coilCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setIronChain = 0x25;
const effectFlagCardTarget = 16;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasCoilScript)("Lua real script Iron Chain Coil target attack defense stat", () => {
  it("restores targeted Iron Chain ATK and DEF update effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${coilCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 53152590, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [coilCode, ironChainTargetCode, nonIronChainDecoyCode] }, 1: { main: [] } });
    startDuel(session);

    const coil = requireCard(session, coilCode);
    const target = requireCard(session, ironChainTargetCode);
    const decoy = requireCard(session, nonIronChainDecoyCode);
    moveFaceUpAttack(session, coil, 0, 0);
    moveFaceUpAttack(session, target, 0, 1);
    moveFaceUpAttack(session, decoy, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(coilCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === coil.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"], sourceUid: coil.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === coil.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === coil.uid), restored.session.state)).toBe(1100);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === coil.uid), restored.session.state)).toBe(1900);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(1500);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(1000);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === decoy.uid), restored.session.state)).toBe(1700);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === coil.uid && [effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetEventStandard }, sourceUid: coil.uid, value: 300 },
      { code: effectUpdateDefense, property: undefined, reset: { flags: resetEventStandard }, sourceUid: coil.uid, value: 300 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentDefense(restoredAfter.session.state.cards.find((card) => card.uid === coil.uid), restoredAfter.session.state)).toBe(1900);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Iron Chain Coil");
  expect(script).toContain("s.listed_series={SET_IRON_CHAIN}");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_IRON_CHAIN)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(300)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
}

function cards(): DuelCardData[] {
  return [
    { code: coilCode, name: "Iron Chain Coil", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceMachine, attribute: attributeEarth, level: 3, attack: 800, defense: 1600, setcodes: [setIronChain] },
    { code: ironChainTargetCode, name: "Iron Chain Coil Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000, setcodes: [setIronChain] },
    { code: nonIronChainDecoyCode, name: "Iron Chain Coil Non-Iron Chain Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
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
