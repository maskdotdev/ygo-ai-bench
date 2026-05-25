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
const unlimiterCode = "82377606";
const allyTargetCode = "823776060";
const nonAojDecoyCode = "823776061";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUnlimiterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${unlimiterCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setAllyOfJustice = 0x1;
const effectFlagCardTarget = 16;
const effectSetAttackFinal = 102;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUnlimiterScript)("Lua real script Ally of Justice Unlimiter self tribute final stat", () => {
  it("restores SelfTribute cost into targeted Ally of Justice printed ATK doubling", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${unlimiterCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 82377606, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [unlimiterCode, allyTargetCode, nonAojDecoyCode] }, 1: { main: [] } });
    startDuel(session);

    const unlimiter = requireCard(session, unlimiterCode);
    const allyTarget = requireCard(session, allyTargetCode);
    const nonAojDecoy = requireCard(session, nonAojDecoyCode);
    moveFaceUpAttack(session, unlimiter, 0, 0);
    moveFaceUpAttack(session, allyTarget, 0, 1);
    moveFaceUpAttack(session, nonAojDecoy, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(unlimiterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === unlimiter.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"], sourceUid: unlimiter.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === unlimiter.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === unlimiter.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: unlimiter.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === allyTarget.uid), restored.session.state)).toBe(3200);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === nonAojDecoy.uid), restored.session.state)).toBe(1700);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === allyTarget.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: allyTarget.uid, value: 3200 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: unlimiter.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: unlimiter.uid, eventReasonEffectId: 1 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: unlimiter.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: unlimiter.uid, eventReasonEffectId: 1 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === allyTarget.uid), restoredAfter.session.state)).toBe(3200);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Ally of Justice Unlimiter");
  expect(script).toContain("e1:SetCost(Cost.SelfTribute)");
  expect(script).toContain("s.listed_series={SET_ALLY_OF_JUSTICE}");
  expect(script).toContain("Duel.IsExistingTarget(aux.FaceupFilter(Card.IsSetCard,SET_ALLY_OF_JUSTICE),tp,LOCATION_MZONE,0,1,e:GetHandler())");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_ALLY_OF_JUSTICE),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetTextAttack()*2)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: unlimiterCode, name: "Ally of Justice Unlimiter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 2, attack: 600, defense: 200, setcodes: [setAllyOfJustice] },
    { code: allyTargetCode, name: "Ally of Justice Unlimiter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 1600, defense: 1000, setcodes: [setAllyOfJustice] },
    { code: nonAojDecoyCode, name: "Unlimiter Non-AOJ Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
