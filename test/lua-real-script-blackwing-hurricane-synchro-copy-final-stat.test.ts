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
const hurricaneCode = "36442179";
const synchroTargetCode = "364421790";
const nonSynchroDecoyCode = "364421791";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHurricaneScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hurricaneCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const raceWingedBeast = 0x200;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const attributeWind = 0x8;
const effectFlagCardTarget = 16;
const effectSetAttackFinal = 102;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasHurricaneScript)("Lua real script Blackwing Hurricane Synchro copy final stat", () => {
  it("restores a face-up Synchro target into the source monster final ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${hurricaneCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 36442179, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hurricaneCode] }, 1: { main: [synchroTargetCode, nonSynchroDecoyCode] } });
    startDuel(session);

    const hurricane = requireCard(session, hurricaneCode);
    const synchroTarget = requireCard(session, synchroTargetCode);
    const nonSynchroDecoy = requireCard(session, nonSynchroDecoyCode);
    moveFaceUpAttack(session, hurricane, 0, 0);
    moveFaceUpAttack(session, synchroTarget, 1, 0);
    moveFaceUpAttack(session, nonSynchroDecoy, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hurricaneCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === hurricane.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"], sourceUid: hurricane.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === hurricane.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === hurricane.uid), restored.session.state)).toBe(2600);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === synchroTarget.uid), restored.session.state)).toBe(2600);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === nonSynchroDecoy.uid), restored.session.state)).toBe(1800);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === hurricane.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: hurricane.uid, value: 2600 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === hurricane.uid), restoredAfter.session.state)).toBe(2600);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Blackwing - Hurricane the Tornado");
  expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_SYNCHRO)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack())");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: hurricaneCode, name: "Blackwing - Hurricane the Tornado", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeDark, level: 1, attack: 0, defense: 0 },
    { code: synchroTargetCode, name: "Hurricane Synchro Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeWind, level: 7, attack: 2600, defense: 1800 },
    { code: nonSynchroDecoyCode, name: "Hurricane Non-Synchro Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
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
