import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const digitJammingCode = "49658464";
const ownCode = "496584640";
const opponentCode = "496584641";
const lowCode = "496584642";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDigitJammingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${digitJammingCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x20000;

describe.skipIf(!hasUpstreamScripts || !hasDigitJammingScript)("Lua real script Digit Jamming precalc destroyed stat", () => {
  it("restores pre-damage final digit stats and destroyed lingering stat recalculation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${digitJammingCode}.lua`);
    expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("local g=Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("local atk=math.floor(tc:GetAttack()/1000)*1000");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(tc:GetAttack()-atk)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetValue(tc:GetDefense()-def)");

    const cards: DuelCardData[] = [
      { code: digitJammingCode, name: "Digit Jamming", kind: "spell", typeFlags: typeSpell | typeContinuous },
      { code: ownCode, name: "Digit Jamming Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2600, defense: 1800 },
      { code: opponentCode, name: "Digit Jamming Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1700, defense: 2400 },
      { code: lowCode, name: "Digit Jamming Low Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const source = { readScript(name: string) { return workspace.readScript(name) ?? ""; } };

    const restoredBattle = createRestoredField({ reader, source, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attacker = requireCard(restoredBattle.session, ownCode);
    const opponent = requireCard(restoredBattle.session, opponentCode);
    expect(currentAttack(attacker, restoredBattle.session.state)).toBe(2600);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === opponent.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredUntilBattleWindow(restoredBattle, "duringDamageCalculation");
    expect(currentAttack(attacker, restoredBattle.session.state)).toBe(600);
    expect(currentDefense(attacker, restoredBattle.session.state)).toBe(800);
    expect(currentAttack(opponent, restoredBattle.session.state)).toBe(700);
    expect(currentDefense(opponent, restoredBattle.session.state)).toBe(400);

    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredDamage);
    expect(restoredDamage.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(currentAttack(restoredDamage.session.state.cards.find((card) => card.uid === attacker.uid), restoredDamage.session.state)).toBe(600);
    passRestoredBattleResponses(restoredDamage);
    expect(restoredDamage.session.state.battleDamage).toEqual({ 0: 100, 1: 0 });
    expect(restoredDamage.session.state.players[0].lifePoints).toBe(7900);

    const restoredDestroyed = createRestoredField({ reader, source, workspace });
    expectCleanRestore(restoredDestroyed);
    const digitJamming = requireCard(restoredDestroyed.session, digitJammingCode);
    const destroyed = destroyDuelCard(restoredDestroyed.session.state, digitJamming.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(destroyed).toMatchObject({ uid: digitJamming.uid, location: "graveyard", reason: duelReason.effect | duelReason.destroy });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyed.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === digitJamming.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    const lingeringAttacker = requireCard(restoredTrigger.session, ownCode);
    const lingeringOpponent = requireCard(restoredTrigger.session, opponentCode);
    const lowDecoy = requireCard(restoredTrigger.session, lowCode);
    expect(currentAttack(lingeringAttacker, restoredTrigger.session.state)).toBe(600);
    expect(currentDefense(lingeringAttacker, restoredTrigger.session.state)).toBe(800);
    expect(currentAttack(lingeringOpponent, restoredTrigger.session.state)).toBe(700);
    expect(currentDefense(lingeringOpponent, restoredTrigger.session.state)).toBe(400);
    expect(currentAttack(lowDecoy, restoredTrigger.session.state)).toBe(900);
    expect(currentDefense(lowDecoy, restoredTrigger.session.state)).toBe(900);
    expect(restoredTrigger.session.state.effects.filter((effect) => [102, 106].includes(effect.code ?? -1)).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { sourceUid: lingeringAttacker.uid, code: 102, reset: { flags: 1107169792 }, value: 600 },
      { sourceUid: lingeringAttacker.uid, code: 106, reset: { flags: 1107169792 }, value: 800 },
      { sourceUid: lingeringOpponent.uid, code: 102, reset: { flags: 1107169792 }, value: 700 },
      { sourceUid: lingeringOpponent.uid, code: 106, reset: { flags: 1107169792 }, value: 400 },
    ]);
  });
});

function createRestoredField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 49658464, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [digitJammingCode, ownCode, lowCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  const digitJamming = requireCard(session, digitJammingCode);
  const attacker = requireCard(session, ownCode);
  const lowDecoy = requireCard(session, lowCode);
  const opponent = requireCard(session, opponentCode);
  moveDuelCard(session.state, digitJamming.uid, "spellTrapZone", 0).faceUp = true;
  moveFaceUpAttack(session, attacker, 0);
  moveFaceUpAttack(session, lowDecoy, 0).sequence = 1;
  moveFaceUpAttack(session, opponent, 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(digitJammingCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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

function passRestoredUntilBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (restored.session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
  if (trigger) {
    applyRestoredActionAndAssert(restored, trigger);
    resolveRestoredChain(restored);
    return;
  }
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
