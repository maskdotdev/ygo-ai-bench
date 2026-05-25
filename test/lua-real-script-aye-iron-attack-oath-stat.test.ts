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
const ayeIronCode = "42969214";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAyeIronScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ayeIronCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectCannotAttack = 85;

describe.skipIf(!hasUpstreamScripts || !hasAyeIronScript)("Lua real script Aye-Iron attack oath stat", () => {
  it("restores attack-announced-count cost into cannot-attack oath and copy-inherit ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${ayeIronCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 42969214, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ayeIronCode] }, 1: { main: [] } });
    startDuel(session);

    const ayeIron = requireCard(session, ayeIronCode);
    moveFaceUpAttack(session, ayeIron, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ayeIronCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === ayeIron.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === ayeIron.uid), restored.session.state)).toBe(2000);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === ayeIron.uid && [effectCannotAttack, effectUpdateAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotAttack, description: 3206, property: 67634176, reset: { flags: 1107169792 }, sourceUid: ayeIron.uid, value: undefined },
      { code: effectUpdateAttack, description: undefined, property: 8192, reset: { flags: 33492992 }, sourceUid: ayeIron.uid, value: 400 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === ayeIron.uid), restoredAfter.session.state)).toBe(2000);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Aye-Iron");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCountLimit(1)");
  expect(script).toContain("return e:GetHandler():GetAttackAnnouncedCount()==0");
  expect(script).toContain("e1:SetDescription(3206)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_OATH+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
  expect(script).toContain("e1:SetValue(400)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
}

function cards(): DuelCardData[] {
  return [
    { code: ayeIronCode, name: "Aye-Iron", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1600, defense: 1800 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
