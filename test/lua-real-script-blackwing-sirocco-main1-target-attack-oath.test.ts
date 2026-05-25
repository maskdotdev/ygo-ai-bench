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
const siroccoCode = "75498415";
const targetCode = "754984150";
const allyCode = "754984151";
const opponentCode = "754984152";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSiroccoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${siroccoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setBlackwing = 0x33;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasSiroccoScript)("Lua real script Blackwing Sirocco main1 target attack oath", () => {
  it("restores Main Phase target boost and other-monster attack oath", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${siroccoCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 75498415, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [siroccoCode, targetCode, allyCode] }, 1: { main: [opponentCode] } });
    startDuel(session);
    const sirocco = requireCard(session, siroccoCode);
    const target = requireCard(session, targetCode);
    const ally = requireCard(session, allyCode);
    const opponent = requireCard(session, opponentCode);
    moveFaceUpAttack(session, sirocco, 0, 0);
    moveFaceUpAttack(session, target, 0, 1);
    moveFaceUpAttack(session, ally, 0, 2);
    moveFaceUpAttack(session, opponent, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(siroccoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === sirocco.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: 32, event: "continuous", range: ["monsterZone"], sourceUid: sirocco.uid },
      { code: 36, event: "continuous", range: ["monsterZone"], sourceUid: sirocco.uid },
      { code: undefined, event: "ignition", range: ["monsterZone"], sourceUid: sirocco.uid },
    ]);

    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === sirocco.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);
    resolveRestoredChain(restored);

    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === sirocco.uid), restored.session.state)).toBe(5000);
    expect(restored.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      label: effect.label,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, controller: 0, event: "continuous", label: undefined, reset: { flags: 1107169792 }, sourceUid: sirocco.uid, targetRange: undefined, value: 3000 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: siroccoCode, name: "Blackwing - Sirocco the Dawn", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBlackwing], level: 5, attack: 2000, defense: 900 },
    { code: targetCode, name: "Sirocco Target Blackwing", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBlackwing], level: 4, attack: 1800, defense: 1000 },
    { code: allyCode, name: "Sirocco Ally Blackwing", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBlackwing], level: 4, attack: 1200, defense: 1000 },
    { code: opponentCode, name: "Sirocco Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Blackwing - Sirocco the Dawn");
  expect(script).toContain("e1:SetCode(EFFECT_SUMMON_PROC)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_PROC)");
  expect(script).toContain("return Duel.IsPhase(PHASE_MAIN1)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_OATH)");
  expect(script).toContain("e2:SetLabel(g:GetFirst():GetFieldID())");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
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
