import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dartonCode = "86271510";
const boostedAllyCode = "862715100";
const weakenedOpponentCode = "862715101";
const unchangedDecoyCode = "862715102";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDartonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dartonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectSetBaseAttack = 103;
const resetStandardPhaseEndOpponentTurn = 1644040704;

describe.skipIf(!hasUpstreamScripts || !hasDartonScript)("Lua real script Darton group difference base attack", () => {
  it("restores fieldwide current/base ATK differences into its original ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dartonCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 86271510, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dartonCode, boostedAllyCode, unchangedDecoyCode] }, 1: { main: [weakenedOpponentCode] } });
    startDuel(session);

    const darton = requireCard(session, dartonCode);
    const boostedAlly = requireCard(session, boostedAllyCode);
    const weakenedOpponent = requireCard(session, weakenedOpponentCode);
    const unchangedDecoy = requireCard(session, unchangedDecoyCode);
    moveFaceUpAttack(session, darton, 0, 0);
    moveFaceUpAttack(session, boostedAlly, 0, 1);
    moveFaceUpAttack(session, weakenedOpponent, 1, 0);
    moveFaceUpAttack(session, unchangedDecoy, 0, 2);
    session.state.effects.push({
      id: "darton-boosted-ally-setup",
      sourceUid: boostedAlly.uid,
      controller: 0,
      event: "continuous",
      code: effectUpdateAttack,
      range: ["monsterZone"],
      value: 500,
      operation: () => {},
    });
    session.state.effects.push({
      id: "darton-weakened-opponent-setup",
      sourceUid: weakenedOpponent.uid,
      controller: 1,
      event: "continuous",
      code: effectUpdateAttack,
      range: ["monsterZone"],
      value: -300,
      operation: () => {},
    });
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    expect(currentAttack(boostedAlly, session.state)).toBe(1900);
    expect(currentAttack(weakenedOpponent, session.state)).toBe(1700);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dartonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === darton.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: darton.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === darton.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === darton.uid), restored.session.state)).toBe(800);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === boostedAlly.uid), restored.session.state)).toBe(1900);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === weakenedOpponent.uid), restored.session.state)).toBe(1700);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === unchangedDecoy.uid), restored.session.state)).toBe(1200);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === darton.uid && effect.code === effectSetBaseAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetBaseAttack, property: undefined, reset: { count: 1, flags: resetStandardPhaseEndOpponentTurn }, sourceUid: darton.uid, value: 800 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === darton.uid), restoredAfter.session.state)).toBe(800);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Darton the Mechanical Monstrosity");
  expect(script).toContain("return c:IsFaceup() and not c:IsAttack(c:GetBaseAttack())");
  expect(script).toContain("Duel.GetMatchingGroup(s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("sum=sum+(math.abs(tc:GetBaseAttack()-tc:GetAttack()))");
  expect(script).toContain("e1:SetCode(EFFECT_SET_BASE_ATTACK)");
  expect(script).toContain("e1:SetValue(sum)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN,1)");
}

function cards(): DuelCardData[] {
  return [
    { code: dartonCode, name: "Darton the Mechanical Monstrosity", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 1, attack: 0, defense: 0 },
    { code: boostedAllyCode, name: "Darton Boosted Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
    { code: weakenedOpponentCode, name: "Darton Weakened Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
    { code: unchangedDecoyCode, name: "Darton Unchanged Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
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
