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
const pyramidCode = "76754619";
const firstMonsterCode = "767546190";
const secondMonsterCode = "767546191";
const opponentDecoyCode = "767546192";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPyramidScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pyramidCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectUpdateDefense = 104;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPyramidScript)("Lua real script Pyramid Energy SelectOption stat", () => {
  it("restores SelectOption label into own face-up DEF group boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${pyramidCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const options = { promptOverrides: [{ api: "SelectOption" as const, returned: 1 }] };

    const restored = createRestoredField({ reader, workspace, options });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const pyramid = requireCard(restored.session, pyramidCode);
    const first = requireCard(restored.session, firstMonsterCode);
    const second = requireCard(restored.session, secondMonsterCode);
    const opponentDecoy = requireCard(restored.session, opponentDecoyCode);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === pyramid.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    expect(restored.host.promptDecisions).toEqual([
      {
        id: "lua-prompt-1",
        api: "SelectOption",
        player: 0,
        options: [0, 1],
        descriptions: [1228073904, 1228073905],
        returned: 1,
      },
    ]);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, first.uid), restored.session.state)).toBe(1400);
    expect(currentDefense(findCard(restored.session, first.uid), restored.session.state)).toBe(1700);
    expect(currentAttack(findCard(restored.session, second.uid), restored.session.state)).toBe(1800);
    expect(currentDefense(findCard(restored.session, second.uid), restored.session.state)).toBe(2500);
    expect(currentDefense(findCard(restored.session, opponentDecoy.uid), restored.session.state)).toBe(1300);
    expect(restored.session.state.effects
      .filter((effect) => effect.code === effectUpdateDefense)
      .map((effect) => ({
        code: effect.code,
        reset: effect.reset,
        sourceUid: effect.sourceUid,
        value: effect.value,
      }))).toEqual([
        { code: effectUpdateDefense, reset: { flags: resetStandardPhaseEnd }, sourceUid: first.uid, value: 500 },
        { code: effectUpdateDefense, reset: { flags: resetStandardPhaseEnd }, sourceUid: second.uid, value: 500 },
      ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const pyramid = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === pyramidCode);
  expect(pyramid).toBeDefined();
  return [
    { ...pyramid!, kind: "trap", typeFlags: typeTrap },
    { code: firstMonsterCode, name: "Pyramid Energy First Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1400, defense: 1200 },
    { code: secondMonsterCode, name: "Pyramid Energy Second Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 2000 },
    { code: opponentDecoyCode, name: "Pyramid Energy Opponent Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1300 },
  ];
}

function createRestoredField({
  reader,
  workspace,
  options,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  options: Parameters<typeof restoreDuelWithLuaScripts>[3];
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 76754619, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [pyramidCode, firstMonsterCode, secondMonsterCode] }, 1: { main: [opponentDecoyCode] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, pyramidCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, firstMonsterCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, secondMonsterCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentDecoyCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace, options);
  expect(host.loadCardScript(Number(pyramidCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, options);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pyramid Energy");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFaceup,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("local op=Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))");
  expect(script).toContain("e:SetLabel(op)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("if e:GetLabel()==0 then");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(200)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e1:SetValue(500)");
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
