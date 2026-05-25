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
const spaceCode = "11224934";
const firstXyzCode = "112249340";
const secondXyzCode = "112249341";
const zeroOverlayCode = "112249342";
const opponentXyzCode = "112249343";
const materialOneCode = "112249344";
const materialTwoCode = "112249345";
const materialThreeCode = "112249346";
const materialFourCode = "112249347";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSpaceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spaceCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSpaceScript)("Lua real script Reinforced Space overlay count stat", () => {
  it("restores own face-up overlay count into per-monster ATK boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${spaceCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const space = requireCard(restored.session, spaceCode);
    const firstXyz = requireCard(restored.session, firstXyzCode);
    const secondXyz = requireCard(restored.session, secondXyzCode);
    const zeroOverlay = requireCard(restored.session, zeroOverlayCode);
    const opponentXyz = requireCard(restored.session, opponentXyzCode);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === space.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, firstXyz.uid), restored.session.state)).toBe(2200);
    expect(currentAttack(findCard(restored.session, secondXyz.uid), restored.session.state)).toBe(2800);
    expect(currentAttack(findCard(restored.session, zeroOverlay.uid), restored.session.state)).toBe(1900);
    expect(currentAttack(findCard(restored.session, opponentXyz.uid), restored.session.state)).toBe(2400);
    expect(restored.session.state.effects
      .filter((effect) => effect.code === effectUpdateAttack)
      .map((effect) => ({
        code: effect.code,
        reset: effect.reset,
        sourceUid: effect.sourceUid,
        value: effect.value,
      }))).toEqual([
        { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: firstXyz.uid, value: 300 },
        { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: secondXyz.uid, value: 900 },
      ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const space = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === spaceCode);
  expect(space).toBeDefined();
  return [
    { ...space!, kind: "trap", typeFlags: typeTrap },
    { code: firstXyzCode, name: "Reinforced Space One Material Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 1000 },
    { code: secondXyzCode, name: "Reinforced Space Three Material Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 1000 },
    { code: zeroOverlayCode, name: "Reinforced Space Zero Overlay Decoy", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 1000 },
    { code: opponentXyzCode, name: "Reinforced Space Opponent Xyz Decoy", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1000 },
    { code: materialOneCode, name: "Reinforced Space Material One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: materialTwoCode, name: "Reinforced Space Material Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: materialThreeCode, name: "Reinforced Space Material Three", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: materialFourCode, name: "Reinforced Space Material Four", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 11224934, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [spaceCode, materialOneCode, materialTwoCode, materialThreeCode, materialFourCode], extra: [firstXyzCode, secondXyzCode, zeroOverlayCode] },
    1: { main: [], extra: [opponentXyzCode] },
  });
  startDuel(session);
  const firstXyz = requireCard(session, firstXyzCode);
  const secondXyz = requireCard(session, secondXyzCode);
  const opponentXyz = requireCard(session, opponentXyzCode);
  moveFaceDownSpellTrap(session, requireCard(session, spaceCode), 0, 0);
  moveFaceUpAttack(session, firstXyz, 0, 0);
  moveFaceUpAttack(session, secondXyz, 0, 1);
  moveFaceUpAttack(session, requireCard(session, zeroOverlayCode), 0, 2);
  moveFaceUpAttack(session, opponentXyz, 1, 0);
  attachOverlay(session, firstXyz, requireCard(session, materialOneCode));
  attachOverlay(session, secondXyz, requireCard(session, materialTwoCode));
  attachOverlay(session, secondXyz, requireCard(session, materialThreeCode));
  attachOverlay(session, secondXyz, requireCard(session, materialFourCode));
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(spaceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Reinforced Space");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("return c:IsFaceup() and c:GetOverlayCount()~=0");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetOverlayCount()*300)");
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

function moveFaceDownSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
  moved.sequence = sequence;
  return moved;
}

function attachOverlay(session: DuelSession, host: DuelCardInstance, material: DuelCardInstance): void {
  moveDuelCard(session.state, material.uid, "overlay", host.controller);
  host.overlayUids.push(material.uid);
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
