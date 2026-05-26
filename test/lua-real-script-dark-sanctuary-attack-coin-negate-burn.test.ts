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
const darkSanctuaryCode = "16625614";
const targetCode = "166256140";
const attackerCode = "166256141";
const hasDarkSanctuaryScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darkSanctuaryCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeField = 0x80000;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasDarkSanctuaryScript)("Lua real script Dark Sanctuary attack coin negate burn", () => {
  it("restores opponent attack announcement into heads TossCoin attack negation and half-ATK damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${darkSanctuaryCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkSanctuaryCode, targetCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const darkSanctuary = requireCard(session, darkSanctuaryCode);
    const target = requireCard(session, targetCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpSpellTrap(session, darkSanctuary, 0, 0);
    moveFaceUpAttack(session, target, 0, 0);
    moveFaceUpAttack(session, attacker, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkSanctuaryCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: target.uid });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1130",
        sourceUid: darkSanctuary.uid,
        player: 0,
        triggerBucket: "opponentMandatory",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        eventUids: [attacker.uid, target.uid],
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === darkSanctuary.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 1002, event: "ignition", range: ["hand", "spellTrapZone"], targetRange: undefined, triggerEvent: undefined },
      { category: undefined, code: Number(darkSanctuaryCode), event: "continuous", range: ["spellTrapZone"], targetRange: [1, 0], triggerEvent: undefined },
      { category: categoryCoin, code: 1130, event: "trigger", range: ["spellTrapZone"], targetRange: undefined, triggerEvent: "attackDeclared" },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === darkSanctuary.uid && action.effectId === "lua-3-1130");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.lastCoinResults).toEqual([1]);
    expect(restoredTrigger.session.state.pendingBattle).toBeUndefined();
    expect(restoredTrigger.session.state.currentAttack).toBeUndefined();
    expect(restoredTrigger.session.state.attackCanceledUids).toEqual([attacker.uid]);
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "coinTossed", "attackDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: attacker.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventUids: [attacker.uid, target.uid],
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkSanctuary.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "attackDisabled",
        eventCode: 1142,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkSanctuary.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Dark Sanctuary");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("e2:SetTargetRange(1,0)");
  expect(script).toContain("e2:SetCode(id)");
  expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e3:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e3:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e3:SetRange(LOCATION_FZONE)");
  expect(script).toContain("local at=Duel.GetAttacker()");
  expect(script).toContain("return at and at:IsControler(1-tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("local tc=Duel.GetAttacker()");
  expect(script).toContain("local coin=Duel.TossCoin(tp,1)");
  expect(script).toContain("if coin==COIN_HEADS and Duel.NegateAttack() then");
  expect(script).toContain("Duel.Damage(1-tp,math.ceil(tc:GetAttack()/2),REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: darkSanctuaryCode, name: "Dark Sanctuary", kind: "spell", typeFlags: typeSpell | typeField },
    { code: targetCode, name: "Dark Sanctuary Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: attackerCode, name: "Dark Sanctuary Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
