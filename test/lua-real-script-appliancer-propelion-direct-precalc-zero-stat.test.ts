import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const propelionCode = "81769387";
const attackerCode = "817693871";
const targetCode = "817693870";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPropelionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${propelionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const setAppliancer = 0x14a;

describe.skipIf(!hasUpstreamScripts || !hasPropelionScript)("Lua real script Appliancer Propelion direct precalc zero stat", () => {
  it("restores direct attack permission and pre-damage trigger metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${propelionCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 81769387, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [propelionCode, attackerCode] }, 1: { main: [targetCode] } });
    startDuel(session);
    const propelion = requireCard(session, propelionCode);
    const attacker = requireCard(session, attackerCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, attacker, 0, 0);
    moveFaceUpAttack(session, propelion, 0, 1);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(propelionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(getLuaRestoreLegalActions(restoredBattle, 0).some((action) => action.type === "declareAttack" && action.attackerUid === propelion.uid && action.targetUid === undefined)).toBe(true);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === propelion.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: 31, event: "continuous", sourceUid: propelion.uid, triggerEvent: undefined },
      { code: 239, event: "continuous", sourceUid: propelion.uid, triggerEvent: undefined },
      { code: 74, event: "continuous", sourceUid: propelion.uid, triggerEvent: undefined },
      { code: 1134, event: "trigger", sourceUid: propelion.uid, triggerEvent: "beforeDamageCalculation" },
      { code: 1134, event: "trigger", sourceUid: propelion.uid, triggerEvent: "beforeDamageCalculation" },
    ]);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: propelionCode, name: "Appliancer Propelion", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setAppliancer], level: 1, attack: 1200, defense: 0, linkMarkers: 0x28 },
    { code: attackerCode, name: "Propelion Co-linked Attacker", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setAppliancer], level: 1, attack: 1600, defense: 0, linkMarkers: 0x20 },
    { code: targetCode, name: "Propelion Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Appliancer Propelion");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_LINK_MATERIAL)");
  expect(script).toContain("e2:SetCode(EFFECT_DIRECT_ATTACK)");
  expect(script).toContain("e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e:GetHandler():GetMutualLinkedGroupCount()>0");
  expect(script).toContain("c:GetMutualLinkedGroupCount()==0");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_DAMAGE_CAL)");
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
