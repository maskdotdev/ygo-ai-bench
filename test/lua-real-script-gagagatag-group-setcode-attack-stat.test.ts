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
const tagCode = "917796";
const firstGagagaCode = "9177960";
const secondGagagaCode = "9177961";
const decoyCode = "9177962";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTagScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tagCode}.lua`));
const setGagaga = 0x54;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeNormal = 0x10;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const resetStandardStandby = 1107169282;
const resetCountTwo = 2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTagScript)("Lua real script Gagagatag group setcode attack stat", () => {
  it("restores aux.Next Gagaga group count into same ATK boost for every matching monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tagCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 917796, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tagCode, firstGagagaCode, secondGagagaCode, decoyCode] }, 1: { main: [] } });
    startDuel(session);
    const tag = requireCard(session, tagCode);
    const first = requireCard(session, firstGagagaCode);
    const second = requireCard(session, secondGagagaCode);
    const decoy = requireCard(session, decoyCode);
    moveFaceDownSpellTrap(session, tag, 0, 0);
    moveFaceUpAttack(session, first, 0, 0);
    moveFaceUpAttack(session, second, 0, 1);
    moveFaceUpAttack(session, decoy, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tagCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === tag.uid && action.effectId === "lua-1-1002"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, first.uid), restored.session.state)).toBe(2500);
    expect(currentAttack(findCard(restored.session, second.uid), restored.session.state)).toBe(2200);
    expect(currentAttack(findCard(restored.session, decoy.uid), restored.session.state)).toBe(1200);
    expect(restored.session.state.effects.filter((effect) =>
      [first.uid, second.uid, decoy.uid].includes(effect.sourceUid ?? "") && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardStandby, count: resetCountTwo }, sourceUid: first.uid, value: 1000 },
      { code: effectUpdateAttack, reset: { flags: resetStandardStandby, count: resetCountTwo }, sourceUid: second.uid, value: 1000 },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expect(currentAttack(findCard(restoredStat.session, first.uid), restoredStat.session.state)).toBe(2500);
    expect(currentAttack(findCard(restoredStat.session, second.uid), restoredStat.session.state)).toBe(2200);
    expect(currentAttack(findCard(restoredStat.session, decoy.uid), restoredStat.session.state)).toBe(1200);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const tag = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === tagCode);
  expect(tag).toBeDefined();
  return [
    { ...tag!, kind: "spell", typeFlags: typeSpell },
    { code: firstGagagaCode, name: "Gagagatag First Gagaga", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1500, defense: 1000, setcodes: [setGagaga] },
    { code: secondGagagaCode, name: "Gagagatag Second Gagaga", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1200, defense: 1000, setcodes: [setGagaga] },
    { code: decoyCode, name: "Gagagatag Decoy", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceSpellcaster, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gagagatag");
  expect(script).toContain("s.listed_series={SET_GAGAGA}");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_GAGAGA),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_GAGAGA),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("local atk=#sg*500");
  expect(script).toContain("for tc in aux.Next(sg) do");
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
