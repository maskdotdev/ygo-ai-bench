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
const gehCode = "82103466";
const allyCode = "821034660";
const opponentCode = "821034661";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGehScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gehCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x8;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasGehScript)("Lua real script Divine Serpent Geh pre-damage final stat", () => {
  it("restores pre-damage Quick Effect into max base-ATK final stat and battle-target final ATK half", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${gehCode}.lua`));
    const reader = createCardReader(cards());
    const restored = createRestoredGehBattle({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const geh = requireCard(restored.session, gehCode);
    const ally = requireCard(restored.session, allyCode);
    const opponent = requireCard(restored.session, opponentCode);
    const attack = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === geh.uid && action.targetUid === opponent.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    advanceToGehActivation(restored, geh.uid);
    expect(restored.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(restored.session.state.pendingBattle).toMatchObject({ attackerUid: geh.uid, targetUid: opponent.uid });

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const action = getLuaRestoreLegalActions(restoredPreDamage, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === geh.uid
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, action!);
    resolveRestoredChain(restoredPreDamage);

    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === geh.uid), restoredPreDamage.session.state)).toBe(3200);
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === opponent.uid), restoredPreDamage.session.state)).toBe(1600);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.code === effectSetAttackFinal && [geh.uid, opponent.uid].includes(effect.sourceUid)).map((effect) => ({
      code: effect.code,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, range: ["monsterZone"], reset: undefined, sourceUid: geh.uid, targetRange: [0, 4], value: undefined },
      { code: effectSetAttackFinal, range: ["monsterZone"], reset: { flags: 33492992 }, sourceUid: geh.uid, targetRange: undefined, value: 3200 },
    ]);
    expect(restoredPreDamage.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventName: "beforeDamageCalculation", eventCode: 1134, eventCardUid: geh.uid, eventReason: 0, eventReasonPlayer: 0, eventUids: [geh.uid, opponent.uid] },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === geh.uid), restoredStat.session.state)).toBe(3200);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === opponent.uid), restoredStat.session.state)).toBe(1600);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === ally.uid), restoredStat.session.state)).toBe(3200);
    finishRestoredBattle(restoredStat);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 1600 });
  });
});

function createRestoredGehBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 82103466, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gehCode, allyCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, gehCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gehCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Divine Serpent Geh");
  expect(script).toContain("e1:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("Duel.PayLPCost(tp,math.floor(Duel.GetLP(tp)/2))");
  expect(script).toContain("e5:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("return math.ceil(c:GetBaseAttack()/2)");
  expect(script).toContain("e6:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e6:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e6:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,c)");
  expect(script).toContain("local g1,atk=g:GetMaxGroup(Card.GetBaseAttack)");
  expect(script).toContain("c:RegisterFlagEffect(id,RESET_CHAIN,0,1)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(atk)");
}

function cards(): DuelCardData[] {
  return [
    { code: gehCode, name: "Divine Serpent Geh", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 12, attack: 0, defense: 0 },
    { code: allyCode, name: "Divine Serpent Geh Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 8, attack: 3200, defense: 2500 },
    { code: opponentCode, name: "Divine Serpent Geh Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function advanceToGehActivation(restored: ReturnType<typeof restoreDuelWithLuaScripts>, gehUid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === gehUid)) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
