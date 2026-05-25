import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const deflectionCode = "66594927";
const targetCode = "665949270";
const allyCode = "665949271";
const defenderCode = "665949272";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDeflectionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${deflectionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setMeklord = 0x13;
const effectSetAttackFinal = 102;
const effectNoBattleDamage = 200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDeflectionScript)("Lua real script Meklord Deflection final no damage replace stat", () => {
  it("restores Meklord base-ATK final stat, no-battle-damage lock, and grave destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${deflectionCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const scenario = createScenario(workspace, reader);
    expectRestoredLegalActions(scenario.restored, 0);

    const activate = getLuaRestoreLegalActions(scenario.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === scenario.deflection.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(scenario.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(scenario.restored, activate!);
    resolveRestoredChain(scenario.restored);

    expect(findCard(scenario.restored.session, scenario.deflection.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(findCard(scenario.restored.session, scenario.target.uid), scenario.restored.session.state)).toBe(3000);
    expect(currentAttack(findCard(scenario.restored.session, scenario.ally.uid), scenario.restored.session.state)).toBe(1800);
    expect(scenario.restored.session.state.effects.filter((effect) =>
      effect.sourceUid === scenario.target.uid && [effectSetAttackFinal, effectNoBattleDamage].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: scenario.target.uid, value: 3000 },
      { code: effectNoBattleDamage, reset: { flags: 1107169792 }, sourceUid: scenario.target.uid, value: undefined },
    ]);
    expect(scenario.restored.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: scenario.target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1 },
      { eventCardUid: scenario.deflection.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);

    expectRestoredLegalActions(scenario.restored, 0);
    const attack = getLuaRestoreLegalActions(scenario.restored, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === scenario.target.uid && action.targetUid === scenario.defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(scenario.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(scenario.restored, attack!);
    passRestoredBattleResponses(scenario.restored);
    expect(scenario.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(scenario.restored.session.state.players[1].lifePoints).toBe(8000);

    destroyDuelCard(scenario.restored.session.state, scenario.ally.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(scenario.restored.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 96, returned: true });
    expect(findCard(scenario.restored.session, scenario.ally.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(findCard(scenario.restored.session, scenario.deflection.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: scenario.deflection.uid,
      reasonEffectId: 2,
    });
    expect(scenario.restored.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === scenario.deflection.uid).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: scenario.deflection.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: scenario.deflection.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);
  });
});

function createScenario(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): { restored: ReturnType<typeof restoreDuelWithLuaScripts>; deflection: DuelCardInstance; target: DuelCardInstance; ally: DuelCardInstance; defender: DuelCardInstance } {
  const session = createDuel({ seed: 66594927, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [deflectionCode, targetCode, allyCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  const deflection = requireCard(session, deflectionCode);
  const target = requireCard(session, targetCode);
  const ally = requireCard(session, allyCode);
  const defender = requireCard(session, defenderCode);
  moveDuelCard(session.state, deflection.uid, "hand", 0);
  moveFaceUpAttack(session, target, 0, 0);
  moveFaceUpAttack(session, ally, 0, 1);
  moveFaceUpAttack(session, defender, 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(deflectionCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restored);
  return { restored, deflection, target, ally, defender };
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const deflection = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === deflectionCode);
  expect(deflection).toBeDefined();
  return [
    deflection!,
    { code: targetCode, name: "Meklord Deflection Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000, setcodes: [setMeklord] },
    { code: allyCode, name: "Meklord Deflection Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000, setcodes: [setMeklord] },
    { code: defenderCode, name: "Meklord Deflection Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Meklord Deflection");
  expect(script).toContain("EFFECT_COUNT_CODE_OATH");
  expect(script).toContain("EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP");
  expect(script).toContain("c:IsFaceup() and c:IsSetCard(SET_MEKLORD)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_MEKLORD),tp,LOCATION_MZONE,0,1,c)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_MEKLORD),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("for bc in aux.Next(g) do");
  expect(script).toContain("atk=atk+bc:GetBaseAttack()");
  expect(script).toContain("EFFECT_SET_ATTACK_FINAL");
  expect(script).toContain("EFFECT_NO_BATTLE_DAMAGE");
  expect(script).toContain("EFFECT_DESTROY_REPLACE");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
  expect(script).toContain("Duel.Remove(e:GetHandler(),POS_FACEUP,REASON_EFFECT)");
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

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
