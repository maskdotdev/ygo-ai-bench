import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const yukiOnnaCode = "66870733";
const destroyedSynchroCode = "668707330";
const opponentTargetCode = "668707331";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasYukiOnnaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${yukiOnnaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeLink = 0x4000000;
const raceZombie = 0x8;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const effectSetAttackFinal = 102;
const effectSetDefenseFinal = 106;

describe.skipIf(!hasUpstreamScripts || !hasYukiOnnaScript)("Lua real script Yuki-Onna destroyed Synchro final stat", () => {
  it("restores delayed destroyed Synchro trigger into targeted final ATK/DEF halves", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${yukiOnnaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createSession({ reader, workspace });
    const yukiOnna = requireCard(session, yukiOnnaCode);
    const destroyedSynchro = requireCard(session, destroyedSynchroCode);
    const opponentTarget = requireCard(session, opponentTargetCode);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    destroyDuelCard(
      restoredOpen.session.state,
      destroyedSynchro.uid,
      0,
      duelReason.effect | duelReason.destroy,
      1,
      "graveyard",
      { eventReasonCardUid: opponentTarget.uid, eventReasonEffectId: 99 },
    );
    expect(restoredOpen.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === yukiOnna.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1029",
        sourceUid: yukiOnna.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "destroyed",
        eventCode: 1029,
        eventPlayer: 0,
        eventCardUid: destroyedSynchro.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: opponentTarget.uid,
        eventReasonEffectId: 99,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === yukiOnna.uid && action.effectId === "lua-3-1029"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(findCard(restoredTrigger.session, yukiOnna.uid), restoredTrigger.session.state)).toBe(1200);
    expect(currentDefense(findCard(restoredTrigger.session, yukiOnna.uid), restoredTrigger.session.state)).toBe(500);
    expect(currentAttack(findCard(restoredTrigger.session, opponentTarget.uid), restoredTrigger.session.state)).toBe(2000);
    expect(restoredTrigger.session.state.effects.filter((effect) =>
      effect.sourceUid === yukiOnna.uid && [effectSetAttackFinal, effectSetDefenseFinal].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: yukiOnna.uid, value: 1200 },
      { code: effectSetDefenseFinal, reset: { flags: 1107169792 }, sourceUid: yukiOnna.uid, value: 500 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "becameTarget"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedSynchro.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: opponentTarget.uid,
        eventReasonEffectId: 99,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: yukiOnna.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(findCard(restoredStat.session, yukiOnna.uid), restoredStat.session.state)).toBe(1200);
    expect(currentDefense(findCard(restoredStat.session, yukiOnna.uid), restoredStat.session.state)).toBe(500);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: yukiOnnaCode, name: "Yuki-Onna, the Ice Mayakashi", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceZombie, attribute: attributeWater, level: 2, attack: 2400, defense: 1000, linkMarkers: 0x28 },
    { code: destroyedSynchroCode, name: "Yuki-Onna Destroyed Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceZombie, attribute: attributeWater, level: 6, attack: 1800, defense: 1600 },
    { code: opponentTargetCode, name: "Yuki-Onna Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1200 },
  ];
}

function createSession({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 66870733, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [yukiOnnaCode, destroyedSynchroCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, yukiOnnaCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, destroyedSynchroCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(yukiOnnaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Yuki-Onna, the Ice Mayakashi");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("c:IsPreviousPosition(POS_FACEUP) and c:IsPreviousControler(tp) and c:GetPreviousTypeOnField()&TYPE_SYNCHRO~=0");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
  expect(script).toContain("e2:SetValue(tc:GetDefense()/2)");
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
