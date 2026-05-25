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
const spiritCode = "45458027";
const machineCode = "454580270";
const targetCode = "454580271";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSpiritScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spiritCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x200;
const raceWarrior = 0x1;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasSpiritScript)("Lua real script Gearspring Spirit machine grave special final ATK", () => {
  it("restores all-Machine grave summon procedure metadata and target ATK set to 0", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${spiritCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 45458027, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [spiritCode, machineCode] }, 1: { main: [targetCode] } });
    startDuel(session);
    const spirit = requireCard(session, spiritCode);
    const machine = requireCard(session, machineCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, spirit, 0, 0);
    moveDuelCard(session.state, machine.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(spiritCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredField = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredField);
    expectRestoredLegalActions(restoredField, 0);
    expect(restoredField.session.state.cards.find((card) => card.uid === spirit.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(restoredField.session.state.effects.filter((effect) => effect.sourceUid === spirit.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 31, event: "continuous", range: ["monsterZone"], sourceUid: spirit.uid },
      { code: 34, event: "summonProcedure", range: ["hand"], sourceUid: spirit.uid },
      { code: undefined, event: "ignition", range: ["monsterZone"], sourceUid: spirit.uid },
    ]);
    const activation = getLuaRestoreLegalActions(restoredField, 0).find((action) => action.type === "activateEffect" && action.uid === spirit.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredField, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredField, activation!);
    resolveRestoredChain(restoredField);

    expect(currentAttack(restoredField.session.state.cards.find((card) => card.uid === target.uid), restoredField.session.state)).toBe(0);
    expect(restoredField.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetCardUids: effect.targetCardUids,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: target.uid, targetCardUids: undefined, value: 0 },
    ]);
    expect(restoredField.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: spiritCode, name: "Gearspring Spirit", kind: "monster", typeFlags: typeMonster | typeEffect, race: machineRace(), level: 8, attack: 100, defense: 100 },
    { code: machineCode, name: "Gearspring Machine Grave", kind: "monster", typeFlags: typeMonster | typeEffect, race: machineRace(), level: 4, attack: 1000, defense: 1000 },
    { code: targetCode, name: "Gearspring Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 2400, defense: 1000 },
  ];
}

function machineRace(): number {
  return raceMachine;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Gearspring Spirit");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("return c:GetRace()~=RACE_MACHINE");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsMonster,tp,LOCATION_GRAVE,0,nil)");
  expect(script).toContain("not g:IsExists(s.cfilter,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
