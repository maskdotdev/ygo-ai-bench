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
const golemCode = "82458280";
const targetCode = "824582800";
const otherAttackerCode = "824582801";
const defenderCode = "824582802";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGolemScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${golemCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceRock = 0x800;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectCannotAttack = 85;
const effectSetAttackFinal = 102;
const effectDirectAttack = 74;

describe.skipIf(!hasUpstreamScripts || !hasGolemScript)("Lua real script Magic Hole Golem direct attack stat", () => {
  it("restores Main Phase target into final ATK halving, direct attack, and attack oath", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${golemCode}.lua`);
    expect(script).toContain("--Magic Hole Golem");
    expect(script).toContain("return Duel.IsPhase(PHASE_MAIN1)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_OATH)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
    expect(script).toContain("e1:SetLabel(g:GetFirst():GetFieldID())");
    expect(script).toContain("return e:GetLabel()~=c:GetFieldID()");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
    expect(script).toContain("e2:SetCode(EFFECT_DIRECT_ATTACK)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 82458280, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [golemCode, targetCode, otherAttackerCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const golem = requireCard(session, golemCode);
    const target = requireCard(session, targetCode);
    const otherAttacker = requireCard(session, otherAttackerCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, target, 0, 0);
    moveFaceUpAttack(session, golem, 0, 1);
    moveFaceUpAttack(session, otherAttacker, 0, 2);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(golemCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const effect = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === golem.uid);
    expect(effect, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, effect!);
    expect(currentAttack(find(restoredOpen.session, target.uid), restoredOpen.session.state)).toBe(800);
    expect(restoredOpen.session.state.effects.filter((candidate) => candidate.sourceUid === golem.uid && candidate.code === effectCannotAttack).map((candidate) => ({
      code: candidate.code,
      event: candidate.event,
      label: candidate.label,
      property: candidate.property,
      range: candidate.range,
      reset: candidate.reset,
      targetRange: candidate.targetRange,
      value: candidate.value,
    }))).toEqual([
      { code: effectCannotAttack, event: "continuous", label: 5, property: 524288, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 1073742336 }, targetRange: [4, 0], value: undefined },
    ]);
    expect(restoredOpen.session.state.effects.filter((candidate) => candidate.sourceUid === target.uid && [effectSetAttackFinal, effectDirectAttack].includes(candidate.code ?? -1)).map((candidate) => ({
      code: candidate.code,
      event: candidate.event,
      property: candidate.property,
      range: candidate.range,
      reset: candidate.reset,
      value: candidate.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", property: 1024, range: ["monsterZone"], reset: { flags: 1107169792 }, value: 800 },
      { code: effectDirectAttack, event: "continuous", property: 1024, range: ["monsterZone"], reset: { flags: 1107169792 }, value: undefined },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 0);
    expect(battleActions.filter((action) => action.type === "declareAttack" && action.attackerUid === golem.uid)).toEqual([]);
    expect(battleActions.filter((action) => action.type === "declareAttack" && action.attackerUid === otherAttacker.uid)).toEqual([]);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === target.uid && action.targetUid === defender.uid)).toBe(true);
    const direct = battleActions.find((action) => action.type === "declareAttack" && action.attackerUid === target.uid && action.directAttack === true);
    expect(direct, JSON.stringify(battleActions, null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, direct!);
    finishRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 800 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: golemCode, name: "Magic Hole Golem", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeDark, level: 3, attack: 0, defense: 2000 },
    { code: targetCode, name: "Magic Hole Golem Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: otherAttackerCode, name: "Magic Hole Golem Other Attacker", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: defenderCode, name: "Magic Hole Golem Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
