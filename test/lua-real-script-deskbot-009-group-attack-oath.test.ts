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
const deskbotCode = "25494711";
const allyOneCode = "254947110";
const allyTwoCode = "254947111";
const nonDeskbotCode = "254947112";
const opponentCode = "254947113";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDeskbotScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${deskbotCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const attributeEarth = 0x10;
const setDeskbot = 0xab;
const effectUpdateAttack = 100;
const effectCannotAttack = 85;
const resetStandardPhaseEndOpponentTurn = 1644040704;
const resetPhaseEnd = 1073742336;

describe.skipIf(!hasUpstreamScripts || !hasDeskbotScript)("Lua real script Deskbot 009 group attack oath", () => {
  it("restores Main Phase Deskbot ATK sum and only-self attack oath", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${deskbotCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restored = createRestoredOpenState({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const deskbot = requireCard(restored.session, deskbotCode);
    const allyOne = requireCard(restored.session, allyOneCode);
    const allyTwo = requireCard(restored.session, allyTwoCode);
    const nonDeskbot = requireCard(restored.session, nonDeskbotCode);
    const opponent = requireCard(restored.session, opponentCode);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === deskbot.uid && action.effectId === "lua-1"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, deskbot.uid), restored.session.state)).toBe(2000);
    expect(currentAttack(findCard(restored.session, allyOne.uid), restored.session.state)).toBe(500);
    expect(currentAttack(findCard(restored.session, allyTwo.uid), restored.session.state)).toBe(1000);
    expect(currentAttack(findCard(restored.session, nonDeskbot.uid), restored.session.state)).toBe(2200);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === deskbot.uid && effect.code !== undefined && [effectUpdateAttack, effectCannotAttack].includes(effect.code)).map((effect) => ({
      code: effect.code,
      label: effect.label,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotAttack, label: deskbot.fieldId, reset: { flags: resetPhaseEnd }, sourceUid: deskbot.uid, targetRange: [4, 0], value: undefined },
      { code: effectUpdateAttack, label: undefined, reset: { flags: resetStandardPhaseEndOpponentTurn }, sourceUid: deskbot.uid, targetRange: undefined, value: 1500 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    restored.session.state.phase = "battle";
    restored.session.state.waitingFor = 0;
    const battleProbe = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(battleProbe);
    expectRestoredLegalActions(battleProbe, 0);
    const battleActions = getLuaRestoreLegalActions(battleProbe, 0);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === deskbot.uid && action.targetUid === opponent.uid)).toBe(true);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === allyOne.uid)).toBe(false);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === allyTwo.uid)).toBe(false);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === nonDeskbot.uid)).toBe(false);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: deskbotCode, name: "Deskbot 009", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, setcodes: [setDeskbot], level: 9, attack: 500, defense: 500 },
    { code: allyOneCode, name: "Deskbot Ally One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, setcodes: [setDeskbot], level: 3, attack: 500, defense: 500 },
    { code: allyTwoCode, name: "Deskbot Ally Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, setcodes: [setDeskbot], level: 4, attack: 1000, defense: 500 },
    { code: nonDeskbotCode, name: "Deskbot Non-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 2200, defense: 500 },
    { code: opponentCode, name: "Deskbot Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1500, defense: 500 },
  ];
}

function createRestoredOpenState({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 25494711, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [deskbotCode, allyOneCode, allyTwoCode, nonDeskbotCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, deskbotCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyOneCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, allyTwoCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, nonDeskbotCode), 0, 3);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(deskbotCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Deskbot 009");
  expect(script).toContain("e1:SetCondition(function() return Duel.IsPhase(PHASE_MAIN1) end)");
  expect(script).toContain("return Duel.IsExistingMatchingCard(s.atkfilter,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_OATH)");
  expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
  expect(script).toContain("e1:SetTarget(s.ftarget)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(s.atkfilter,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("local atk=g:GetSum(Card.GetAttack)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN)");
  expect(script).toContain("e1:SetValue(atk)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ACTIVATE)");
  expect(script).toContain("e3:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
  expect(script).toContain("Duel.SetTargetCard(g)");
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
