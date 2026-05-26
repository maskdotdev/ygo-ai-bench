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
const triangleCode = "12181376";
const harpieSistersCode = "12206212";
const trapDecoyCode = "121813760";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTriangleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${triangleCode}.lua`));
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeMonster = 0x1;
const typeNormal = 0x10;
const raceWingedBeast = 0x80;
const attributeWind = 0x10;
const effectDisable = 2;
const effectCannotActivate = 6;
const effectDisableTrapMonster = 10;
const effectSetAttackFinal = 102;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTriangleScript)("Lua real script Triangle Ecstasy Spark Harpie trap lock stat", () => {
  it("restores activation into all Harpie Lady Sisters final ATK and opponent Trap lock effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${triangleCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 12181376, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [triangleCode, harpieSistersCode] }, 1: { main: [harpieSistersCode, trapDecoyCode] } });
    startDuel(session);

    const triangle = requireCard(session, triangleCode);
    const ownHarpie = session.state.cards.find((card) => card.code === harpieSistersCode && card.owner === 0);
    const opponentHarpie = session.state.cards.find((card) => card.code === harpieSistersCode && card.owner === 1);
    const trapDecoy = requireCard(session, trapDecoyCode);
    expect(ownHarpie).toBeDefined();
    expect(opponentHarpie).toBeDefined();
    moveDuelCard(session.state, triangle.uid, "hand", 0);
    moveFaceUpAttack(session, ownHarpie!, 0, 0);
    moveFaceUpAttack(session, opponentHarpie!, 1, 0);
    moveFaceUpSpellTrap(session, trapDecoy, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(triangleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === triangle.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    expect(currentAttack(findCard(restoredOpen.session, ownHarpie!.uid), restoredOpen.session.state)).toBe(2700);
    expect(currentAttack(findCard(restoredOpen.session, opponentHarpie!.uid), restoredOpen.session.state)).toBe(2700);
    expect(restoredOpen.session.state.effects.filter((effect) =>
      [ownHarpie!.uid, opponentHarpie!.uid].includes(effect.sourceUid) && effect.code === effectSetAttackFinal
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    })).sort((left, right) => left.sourceUid.localeCompare(right.sourceUid))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: ownHarpie!.uid, value: 2700 },
      { code: effectSetAttackFinal, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: opponentHarpie!.uid, value: 2700 },
    ].sort((left, right) => left.sourceUid.localeCompare(right.sourceUid)));
    expect(restoredOpen.session.state.effects.filter((effect) =>
      effect.sourceUid === triangle.uid && effect.code !== undefined && [effectCannotActivate, effectDisable, effectDisableTrapMonster].includes(effect.code)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    })).sort((left, right) => (left.code ?? 0) - (right.code ?? 0))).toEqual([
      { code: effectDisable, event: "continuous", range: allLocations, reset: { flags: 1073742336 }, sourceUid: triangle.uid, targetRange: [0, 8] },
      { code: effectCannotActivate, event: "continuous", range: allLocations, reset: { flags: 1073742336 }, sourceUid: triangle.uid, targetRange: [0, 1] },
      { code: effectDisableTrapMonster, event: "continuous", range: allLocations, reset: { flags: 1073742336 }, sourceUid: triangle.uid, targetRange: [0, 4] },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const triangle = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === triangleCode);
  const harpie = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === harpieSistersCode);
  expect(triangle).toBeDefined();
  expect(harpie).toBeDefined();
  return [
    { ...triangle!, kind: "spell", typeFlags: typeSpell },
    { ...harpie!, kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWingedBeast, attribute: attributeWind, level: 6, attack: 1950, defense: 2100 },
    { code: trapDecoyCode, name: "Triangle Ecstasy Spark Fixture Trap", kind: "trap", typeFlags: typeTrap },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Triangle Ecstasy Spark");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_HARPIE_LADY_SISTERS),tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsCode,CARD_HARPIE_LADY_SISTERS),tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(2700)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ACTIVATE)");
  expect(script).toContain("e1:SetTargetRange(0,1)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetTargetRange(0,LOCATION_SZONE)");
  expect(script).toContain("Duel.RegisterEffect(e2,tp)");
  expect(script).toContain("e3:SetCode(EFFECT_DISABLE_TRAPMONSTER)");
  expect(script).toContain("e3:SetTargetRange(0,LOCATION_MZONE)");
  expect(script).toContain("Duel.RegisterEffect(e3,tp)");
  expect(script).toContain("return re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:IsTrapEffect()");
  expect(script).toContain("return c:IsTrap()");
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
