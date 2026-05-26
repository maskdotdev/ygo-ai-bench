import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const rouletteSpiderCode = "36708764";
const attackTargetCode = "367087640";
const alternateTargetCode = "367087641";
const attackerCode = "367087642";
const hasRouletteSpiderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rouletteSpiderCode}.lua`));
const categoryDiceDamageDestroy = 0x2000000 | 0x80000 | 0x1;
const typeMonster = 0x1;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasRouletteSpiderScript)("Lua real script Roulette Spider dice CalculateDamage", () => {
  it("restores attack-announcement dice branch into selected alternate battle calculation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rouletteSpiderCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rouletteSpiderCode, attackTargetCode, alternateTargetCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const rouletteSpider = requireCard(session, rouletteSpiderCode);
    const attackTarget = requireCard(session, attackTargetCode);
    const alternateTarget = requireCard(session, alternateTargetCode);
    const attacker = requireCard(session, attackerCode);
    moveSpellTrap(session, rouletteSpider, 0, 0);
    moveFaceUpAttack(session, attackTarget, 0, 0);
    moveFaceUpAttack(session, alternateTarget, 0, 1);
    moveFaceUpAttack(session, attacker, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rouletteSpiderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === attackTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === rouletteSpider.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryDiceDamageDestroy, code: 1130, event: "quick", range: ["spellTrapZone"], triggerEvent: "attackDeclared" },
    ]);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === rouletteSpider.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestored(restored, activation!);
    passRestoredChain(restored);

    expect(restored.session.state.lastDiceResults).toEqual([3]);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.players[0].lifePoints).toBe(7600);
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    expect(restored.session.state.cards.find((card) => card.uid === alternateTarget.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.battle | duelReason.destroy, reasonPlayer: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === rouletteSpider.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => ["attackDeclared", "diceTossed", "battleDamageDealt", "sentToGraveyard"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "attackDeclared", eventCode: 1130, eventCardUid: attacker.uid, eventPlayer: undefined, eventValue: undefined, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "diceTossed", eventCode: 1150, eventCardUid: undefined, eventPlayer: 0, eventValue: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: rouletteSpider.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: attacker.uid, eventPlayer: 0, eventValue: 400, eventReason: duelReason.battle, eventReasonPlayer: 1, eventReasonCardUid: attacker.uid, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: alternateTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: attacker.uid, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: rouletteSpider.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: rouletteSpiderCode, name: "Roulette Spider", kind: "trap", typeFlags: typeTrap },
    { code: attackTargetCode, name: "Roulette Spider Original Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: alternateTargetCode, name: "Roulette Spider Alternate Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
    { code: attackerCode, name: "Roulette Spider Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Roulette Spider");
  expect(script).toContain("e1:SetCategory(CATEGORY_DICE+CATEGORY_DAMAGE+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return ep==1-tp");
  expect(script).toContain("Duel.SetTargetCard(at)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DICE,nil,0,tp,1)");
  expect(script).toContain("local dc=Duel.TossDice(tp,1)");
  expect(script).toContain("Duel.SetLP(tp,math.ceil(lp/2))");
  expect(script).toContain("Duel.ChangeAttackTarget(nil)");
  expect(script).toContain("Duel.CalculateDamage(at,tc)");
  expect(script).toContain("Duel.NegateAttack()");
  expect(script).toContain("Duel.Damage(1-tp,at:GetAttack(),REASON_EFFECT)");
  expect(script).toContain("Duel.Destroy(at,REASON_EFFECT)");
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

function moveSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDown";
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? 0;
    expectRestoredLegalActions(restored, player);
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    relatedEffectId: event.relatedEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
  };
}
