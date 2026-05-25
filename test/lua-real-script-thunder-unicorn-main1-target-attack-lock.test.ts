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
const unicornCode = "77506119";
const allyCode = "775061190";
const targetCode = "775061191";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasUnicornScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${unicornCode}.lua`));
const typeMonster = 0x1;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectCannotAttack = 85;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasUnicornScript)("Lua real script Thunder Unicorn Main1 target attack lock", () => {
  it("restores Main Phase opponent ATK reduction and locks other own attacks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${unicornCode}.lua`);
    expect(script).toContain("--Thunder Unicorn");
    expect(script).toContain("return Duel.IsPhase(PHASE_MAIN1)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)*-500)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
    expect(script).toContain("e2:SetTargetRange(LOCATION_MZONE,0)");
    expect(script).toContain("return c~=e:GetOwner()");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 77506119, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [allyCode], extra: [unicornCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const unicorn = requireCard(session, unicornCode);
    const ally = requireCard(session, allyCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, unicorn, 0, 0);
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(unicornCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredMain = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredMain);
    expectRestoredLegalActions(restoredMain, 0);
    const ignition = getLuaRestoreLegalActions(restoredMain, 0).find((action) => action.type === "activateEffect" && action.uid === unicorn.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredMain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMain, ignition!);
    expect(currentAttack(find(restoredMain.session, target.uid), restoredMain.session.state)).toBe(1000);
    expect(restoredMain.session.state.effects.filter((effect) =>
      (effect.sourceUid === target.uid && effect.code === effectUpdateAttack) || (effect.sourceUid === unicorn.uid && effect.code === effectCannotAttack)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: undefined, reset: { flags: 1107169792 }, sourceUid: target.uid, targetRange: undefined, value: -1000 },
      { code: effectCannotAttack, event: "continuous", property: 128, reset: { flags: 1073742336 }, sourceUid: unicorn.uid, targetRange: [4, 0], value: undefined },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredMain.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 0);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === unicorn.uid && action.targetUid === target.uid)).toBe(true);
    expect(battleActions.filter((action) => action.type === "declareAttack" && action.attackerUid === ally.uid)).toEqual([]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === unicornCode),
    { code: allyCode, name: "Thunder Unicorn Ally", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: targetCode, name: "Thunder Unicorn Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function find(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
