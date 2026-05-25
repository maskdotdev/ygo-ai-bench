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
const gagagatagCode = "917796";
const gagagaOneCode = "9177960";
const gagagaTwoCode = "9177961";
const nonGagagaCode = "9177962";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasGagagatagScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gagagatagCode}.lua`));
const setGagaga = 0x54;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const resetStandardStandbyTwo = 1107169282;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGagagatagScript)("Lua real script Gagagatag group stat", () => {
  it("restores all face-up Gagaga monsters receiving shared count-based ATK boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gagagatagCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const gagagatag = requireCard(restored.session, gagagatagCode);
    const gagagaOne = requireCard(restored.session, gagagaOneCode);
    const gagagaTwo = requireCard(restored.session, gagagaTwoCode);
    const nonGagaga = requireCard(restored.session, nonGagagaCode);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === gagagatag.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, gagagaOne.uid), restored.session.state)).toBe(2500);
    expect(currentAttack(findCard(restored.session, gagagaTwo.uid), restored.session.state)).toBe(2200);
    expect(currentAttack(findCard(restored.session, nonGagaga.uid), restored.session.state)).toBe(1700);
    expect(restored.session.state.effects.filter((effect) =>
      [gagagaOne.uid, gagagaTwo.uid, nonGagaga.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { count: 2, flags: resetStandardStandbyTwo }, sourceUid: gagagaOne.uid, value: 1000 },
      { code: effectUpdateAttack, property: undefined, reset: { count: 2, flags: resetStandardStandbyTwo }, sourceUid: gagagaTwo.uid, value: 1000 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const gagagatag = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === gagagatagCode);
  expect(gagagatag).toBeDefined();
  return [
    { ...gagagatag!, kind: "spell", typeFlags: typeSpell },
    { code: gagagaOneCode, name: "Gagagatag Fixture One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1500, defense: 1000, setcodes: [setGagaga] },
    { code: gagagaTwoCode, name: "Gagagatag Fixture Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1200, defense: 1000, setcodes: [setGagaga] },
    { code: nonGagagaCode, name: "Gagagatag Non-Gagaga Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 917796, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gagagatagCode, gagagaOneCode, gagagaTwoCode, nonGagagaCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, gagagatagCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, gagagaOneCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, gagagaTwoCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, nonGagagaCode), 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gagagatagCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gagagatag");
  expect(script).toContain("s.listed_series={SET_GAGAGA}");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_GAGAGA),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_GAGAGA),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("local atk=#sg*500");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_STANDBY,2)");
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
