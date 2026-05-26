import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const muzanichihaCode = "39118197";
const allyCode = "391181970";
const attackerCode = "391181971";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMuzanichihaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${muzanichihaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setKarakuri = 0x11;

describe.skipIf(!hasUpstreamScripts || !hasMuzanichihaScript)("Lua real script Karakuri Muzanichiha destroyed position stat", () => {
  it("restores must-attack, battle-target defense change, and destroyed Karakuri ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${muzanichihaCode}.lua`);
    expectMuzanichihaScriptShape(script);

    const { reader, session } = createMuzanichihaSession();
    const muzanichiha = requireCard(session, muzanichihaCode);
    const ally = requireCard(session, allyCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpAttack(session, muzanichiha, 0, 0);
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, attacker, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(muzanichihaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === muzanichiha.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 191, event: "continuous", range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: 0x1000, code: 1131, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "battleTargeted", value: undefined },
      { category: 0x200000, code: 1029, event: "trigger", range: ["monsterZone"], triggerEvent: "destroyed", value: undefined },
    ]);

    const restoredTargeted = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTargeted);
    expectRestoredLegalActions(restoredTargeted, 1);
    const attack = getLuaRestoreLegalActions(restoredTargeted, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === muzanichiha.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredTargeted, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTargeted, attack!);
    expect(restoredTargeted.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1131",
        eventCardUid: muzanichiha.uid,
        eventCode: 1131,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleTargeted",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: muzanichiha.uid,
        triggerBucket: "opponentMandatory",
      },
    ]);

    const restoredPosition = restoreDuelWithLuaScripts(serializeDuel(restoredTargeted.session), workspace, reader);
    expectCleanRestore(restoredPosition);
    expectRestoredLegalActions(restoredPosition, 0);
    const positionTrigger = getLuaRestoreLegalActions(restoredPosition, 0).find((action) => action.type === "activateTrigger" && action.uid === muzanichiha.uid);
    expect(positionTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredPosition, 0), null, 2)).toBeDefined();
    expect(positionTrigger).not.toHaveProperty("operationInfos");
    applyRestoredActionAndAssert(restoredPosition, positionTrigger!);
    resolveRestoredChain(restoredPosition);
    expect(restoredPosition.session.state.cards.find((card) => card.uid === muzanichiha.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpDefense" });
    expect(restoredPosition.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === muzanichiha.uid)).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: muzanichiha.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: muzanichiha.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);

    const restoredMustAttack = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredMustAttack);
    restoredMustAttack.session.state.turnPlayer = 0;
    restoredMustAttack.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredMustAttack, 0);
    const mustAttackActions = getLuaRestoreLegalActions(restoredMustAttack, 0);
    expect(mustAttackActions.some((action) => action.type === "declareAttack" && action.attackerUid === muzanichiha.uid && action.targetUid === attacker.uid)).toBe(true);
    expect(mustAttackActions.some((action) => action.type === "changePhase")).toBe(false);
    expect(mustAttackActions.some((action) => action.type === "endTurn")).toBe(false);

    const { reader: destroyReader, session: destroySession } = createMuzanichihaSession();
    const destroyMuzanichiha = requireCard(destroySession, muzanichihaCode);
    const destroyAlly = requireCard(destroySession, allyCode);
    moveFaceUpAttack(destroySession, destroyMuzanichiha, 0, 0);
    moveFaceUpAttack(destroySession, destroyAlly, 0, 1);
    destroySession.state.phase = "main1";
    destroySession.state.turnPlayer = 0;
    destroySession.state.waitingFor = 0;

    const destroyHost = createLuaScriptHost(destroySession, workspace);
    expect(destroyHost.loadCardScript(Number(muzanichihaCode), workspace).ok).toBe(true);
    expect(destroyHost.registerInitialEffects()).toBe(1);
    const destroyed = destroyHost.loadScript(
      `
      local ally=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${allyCode}),0,LOCATION_MZONE,0,nil)
      Debug.Message("muzanichiha destroyed ally " .. Duel.Destroy(ally,REASON_EFFECT))
      `,
      "karakuri-muzanichiha-destroyed-ally.lua",
    );
    expect(destroyed.ok, destroyed.error).toBe(true);
    expect(destroyHost.messages).toContain("muzanichiha destroyed ally 1");
    expect(destroySession.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1029",
        eventCardUid: destroyAlly.uid,
        eventCode: 1029,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "destroyed",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: destroyMuzanichiha.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(destroySession), workspace, destroyReader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const statTrigger = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyMuzanichiha.uid);
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    expect(statTrigger).not.toHaveProperty("operationInfos");
    applyRestoredActionAndAssert(restoredDestroyed, statTrigger!);
    resolveRestoredChain(restoredDestroyed);

    expect(currentAttack(restoredDestroyed.session.state.cards.find((card) => card.uid === destroyMuzanichiha.uid), restoredDestroyed.session.state)).toBe(2200);
    expect(restoredDestroyed.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredDestroyed.session.state.effects.filter((effect) => effect.sourceUid === destroyMuzanichiha.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 33492992 }, value: 400 }]);
  });
});

function createMuzanichihaSession(): { reader: ReturnType<typeof createCardReader>; session: DuelSession } {
  const cards: DuelCardData[] = [
    { code: muzanichihaCode, name: 'Karakuri Bushi mdl 6318 "Muzanichiha"', kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKarakuri], level: 4, attack: 1800, defense: 600 },
    { code: allyCode, name: "Karakuri Muzanichiha Destroyed Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKarakuri], level: 4, attack: 1200, defense: 1000 },
    { code: attackerCode, name: "Karakuri Muzanichiha Battle Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 39118197, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [muzanichihaCode, allyCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  return { reader, session };
}

function expectMuzanichihaScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EFFECT_MUST_ATTACK)");
  expect(script).toContain("e3:SetCategory(CATEGORY_POSITION)");
  expect(script).toContain("e3:SetCode(EVENT_BE_BATTLE_TARGET)");
  expect(script).toContain("return e:GetHandler():IsAttackPos()");
  expect(script).toContain("Duel.ChangePosition(c,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e4:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e4:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousPosition(POS_FACEUP) and c:IsPreviousSetCard(SET_KARAKURI)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("e1:SetValue(400)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = (restored.session.state.waitingFor ?? restored.session.state.turnPlayer) as PlayerId;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
