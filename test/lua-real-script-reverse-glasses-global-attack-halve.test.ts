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
const reverseGlassesCode = "94156050";
const ownMonsterCode = "941560500";
const opponentMonsterCode = "941560501";
const facedownDecoyCode = "941560502";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasReverseGlassesScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${reverseGlassesCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectSetAttackFinal = 102;
const resetsStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasReverseGlassesScript)("Lua real script Reverse Glasses global attack halve", () => {
  it("restores both-field face-up final ATK halve until phase end", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${reverseGlassesCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const reverseGlasses = requireCard(restored.session, reverseGlassesCode);
    const ownMonster = requireCard(restored.session, ownMonsterCode);
    const opponentMonster = requireCard(restored.session, opponentMonsterCode);
    const facedownDecoy = requireCard(restored.session, facedownDecoyCode);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === reverseGlasses.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, ownMonster.uid), restored.session.state)).toBe(800);
    expect(currentAttack(findCard(restored.session, opponentMonster.uid), restored.session.state)).toBe(1050);
    expect(currentAttack(findCard(restored.session, facedownDecoy.uid), restored.session.state)).toBe(2000);
    expect(restored.session.state.effects
      .filter((effect) => effect.code === effectSetAttackFinal)
      .map((effect) => ({
        code: effect.code,
        reset: effect.reset,
        sourceUid: effect.sourceUid,
        value: effect.value,
      }))).toEqual([
        { code: effectSetAttackFinal, reset: { flags: resetsStandardPhaseEnd }, sourceUid: ownMonster.uid, value: 800 },
        { code: effectSetAttackFinal, reset: { flags: resetsStandardPhaseEnd }, sourceUid: opponentMonster.uid, value: 1050 },
      ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const reverseGlasses = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === reverseGlassesCode);
  expect(reverseGlasses).toBeDefined();
  return [
    { ...reverseGlasses!, kind: "trap", typeFlags: typeTrap },
    { code: ownMonsterCode, name: "Reverse Glasses Own Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
    { code: opponentMonsterCode, name: "Reverse Glasses Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2100, defense: 1000 },
    { code: facedownDecoyCode, name: "Reverse Glasses Facedown Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 400 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 94156050, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [reverseGlassesCode, ownMonsterCode, facedownDecoyCode] }, 1: { main: [opponentMonsterCode] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, reverseGlassesCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ownMonsterCode), 0, 0);
  moveFaceDownDefense(session, requireCard(session, facedownDecoyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentMonsterCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(reverseGlassesCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Reverse Glasses");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
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

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = false;
  moved.position = "faceDownDefense";
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
