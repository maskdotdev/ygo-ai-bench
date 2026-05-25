import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const darkAngelCode = "28593329";
const fairyTargetCode = "285933290";
const retargetCode = "285933291";
const attackerCode = "285933292";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDarkAngelScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darkAngelCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasDarkAngelScript)("Lua real script Dark Angel battle retarget stat", () => {
  it("restores its hand battle-target trigger, cost release/send, attack retarget, and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${darkAngelCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 28593329, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkAngelCode, fairyTargetCode, retargetCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const darkAngel = requireCard(session, darkAngelCode);
    const fairyTarget = requireCard(session, fairyTargetCode);
    const retarget = requireCard(session, retargetCode);
    const attacker = requireCard(session, attackerCode);
    moveDuelCard(session.state, darkAngel.uid, "hand", 0);
    moveFaceUpAttack(session, fairyTarget, 0);
    moveFaceUpAttack(session, retarget, 0);
    moveFaceUpAttack(session, attacker, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkAngelCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === fairyTarget.uid
    );
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === darkAngel.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1131",
        eventCardUid: fairyTarget.uid,
        eventCode: 1131,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleTargeted",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: darkAngel.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === darkAngel.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, trigger!);
    passRestoredChain(restored);

    const resolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(resolved);
    expectRestoredLegalActions(resolved, 1);
    expect(resolved.session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: retarget.uid });
    expect(currentAttack(resolved.session.state.cards.find((card) => card.uid === retarget.uid), resolved.session.state)).toBe(2800);
    expect(resolved.session.state.cards.find((card) => card.uid === fairyTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: darkAngel.uid,
      reasonEffectId: 1,
    });
    expect(resolved.session.state.cards.find((card) => card.uid === darkAngel.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: darkAngel.uid,
      reasonEffectId: 1,
    });
    expect(resolved.session.state.effects.filter((effect) => effect.sourceUid === retarget.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792 }, value: 1600 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: darkAngelCode, name: "Dark Angel", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeDark, level: 5, attack: 0, defense: 0 },
    { code: fairyTargetCode, name: "Dark Angel Fairy Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: retargetCode, name: "Dark Angel Retarget", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: attackerCode, name: "Dark Angel Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2200, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Dark Angel");
  expect(script).toContain("e1:SetCode(EVENT_BE_BATTLE_TARGET)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e:GetHandler():IsAbleToGraveAsCost()");
  expect(script).toContain("at:IsRace(RACE_FAIRY) and at:IsReleasable()");
  expect(script).toContain("e:SetLabel(at:GetBaseAttack())");
  expect(script).toContain("Duel.Release(at,REASON_COST)");
  expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,at)");
  expect(script).toContain("Duel.ChangeAttackTarget(tc)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
}

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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
