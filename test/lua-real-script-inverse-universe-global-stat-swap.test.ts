import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const inverseUniverseCode = "79161790";
const ownEffectCode = "791617900";
const opponentEffectCode = "791617901";
const normalDecoyCode = "791617902";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasInverseUniverseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${inverseUniverseCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectSetAttackFinal = 102;
const effectSetDefenseFinal = 106;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasInverseUniverseScript)("Lua real script Inverse Universe global stat swap", () => {
  it("restores both-field Effect Monster ATK and DEF final stat swap", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${inverseUniverseCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const inverseUniverse = requireCard(restored.session, inverseUniverseCode);
    const ownEffect = requireCard(restored.session, ownEffectCode);
    const opponentEffect = requireCard(restored.session, opponentEffectCode);
    const normalDecoy = requireCard(restored.session, normalDecoyCode);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === inverseUniverse.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, ownEffect.uid), restored.session.state)).toBe(900);
    expect(currentDefense(findCard(restored.session, ownEffect.uid), restored.session.state)).toBe(1700);
    expect(currentAttack(findCard(restored.session, opponentEffect.uid), restored.session.state)).toBe(2300);
    expect(currentDefense(findCard(restored.session, opponentEffect.uid), restored.session.state)).toBe(1100);
    expect(currentAttack(findCard(restored.session, normalDecoy.uid), restored.session.state)).toBe(1900);
    expect(currentDefense(findCard(restored.session, normalDecoy.uid), restored.session.state)).toBe(600);
    expect(restored.session.state.effects
      .filter((effect) => [effectSetAttackFinal, effectSetDefenseFinal].includes(effect.code ?? -1))
      .map((effect) => ({
        code: effect.code,
        reset: effect.reset,
        sourceUid: effect.sourceUid,
        value: effect.value,
      }))).toEqual([
        { code: effectSetAttackFinal, reset: { flags: resetEventStandard }, sourceUid: ownEffect.uid, value: 900 },
        { code: effectSetDefenseFinal, reset: { flags: resetEventStandard }, sourceUid: ownEffect.uid, value: 1700 },
        { code: effectSetAttackFinal, reset: { flags: resetEventStandard }, sourceUid: opponentEffect.uid, value: 2300 },
        { code: effectSetDefenseFinal, reset: { flags: resetEventStandard }, sourceUid: opponentEffect.uid, value: 1100 },
      ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const inverseUniverse = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === inverseUniverseCode);
  expect(inverseUniverse).toBeDefined();
  return [
    { ...inverseUniverse!, kind: "trap", typeFlags: typeTrap },
    { code: ownEffectCode, name: "Inverse Universe Own Effect Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 900 },
    { code: opponentEffectCode, name: "Inverse Universe Opponent Effect Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1100, defense: 2300 },
    { code: normalDecoyCode, name: "Inverse Universe Normal Decoy", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 600 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 79161790, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [inverseUniverseCode, ownEffectCode, normalDecoyCode] }, 1: { main: [opponentEffectCode] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, inverseUniverseCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ownEffectCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, normalDecoyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentEffectCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(inverseUniverseCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Inverse Universe");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_EFFECT) and c:IsDefenseAbove(0)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("local sg=Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("local atk=tc:GetAttack()");
  expect(script).toContain("local def=tc:GetDefense()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("e1:SetValue(def)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
  expect(script).toContain("e2:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("e2:SetValue(atk)");
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
