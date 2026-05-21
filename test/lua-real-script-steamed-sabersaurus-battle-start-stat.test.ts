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
const sabersaurusCode = "3743515";
const dinosaurAttackerCode = "37435150";
const opponentTargetCode = "37435151";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSabersaurusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sabersaurusCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDinosaur = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasSabersaurusScript)("Lua real script Steamed Sabersaurus battle-start stat", () => {
  it("restores field battle-start self destroy into a Dinosaur battler ATK boost through damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sabersaurusCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,4,2)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_POSITION,nil,1,tp,0)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_START)");
    expect(script).toContain("local a=Duel.GetAttacker()");
    expect(script).toContain("local b=Duel.GetAttackTarget()");
    expect(script).toContain("return a:IsFaceup() and a:IsRace(RACE_DINOSAUR) and a~=e:GetHandler()");
    expect(script).toContain("Duel.SetTargetCard(a)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,tp,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,a,1,tp,2000)");
    expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)>0 and bc:IsRelateToEffect(e)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(2000)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_BATTLE)");

    const cards: DuelCardData[] = [
      { code: sabersaurusCode, name: "Steamed Sabersaurus", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDinosaur, level: 4, attack: 2000, defense: 0 },
      { code: dinosaurAttackerCode, name: "Steamed Sabersaurus Dinosaur Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, level: 4, attack: 1500, defense: 1000 },
      { code: opponentTargetCode, name: "Steamed Sabersaurus Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3743515, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dinosaurAttackerCode], extra: [sabersaurusCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);

    const sabersaurus = requireCard(session, sabersaurusCode);
    const dinosaurAttacker = requireCard(session, dinosaurAttackerCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveFaceUpAttack(session, sabersaurus, 0);
    moveFaceUpAttack(session, dinosaurAttacker, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sabersaurusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === dinosaurAttacker.uid && action.targetUid === opponentTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passUntilBattleStarted(restoredOpen);
    expect(restoredOpen.session.state.pendingTriggers).toMatchObject([
      {
        eventCardUid: dinosaurAttacker.uid,
        eventName: "battleStarted",
        sourceUid: sabersaurus.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === sabersaurus.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === sabersaurus.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: sabersaurus.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === dinosaurAttacker.uid), restoredTrigger.session.state)).toBe(3500);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === dinosaurAttacker.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x400, reset: { flags: 1107169408 }, sourceUid: dinosaurAttacker.uid, value: 2000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: dinosaurAttacker.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: sabersaurus.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: sabersaurus.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredDamage);
    finishBattle(restoredDamage);
    expect(restoredDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 1300 });
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function passUntilBattleStarted(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.battleWindow?.kind !== "startDamageStep") {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
