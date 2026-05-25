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
const boosterCode = "88032368";
const attackTargetCode = "880323680";
const defenseDecoyCode = "880323681";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBoosterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${boosterCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const effectFlagCardTarget = 16;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasBoosterScript)("Lua real script Second Booster self tribute attack stat", () => {
  it("restores SelfTribute cost into face-up attack-position target ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${boosterCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 88032368, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [boosterCode, attackTargetCode, defenseDecoyCode] }, 1: { main: [] } });
    startDuel(session);

    const booster = requireCard(session, boosterCode);
    const attackTarget = requireCard(session, attackTargetCode);
    const defenseDecoy = requireCard(session, defenseDecoyCode);
    moveFaceUpAttack(session, booster, 0, 0);
    moveFaceUpAttack(session, attackTarget, 0, 1);
    moveFaceUpDefense(session, defenseDecoy, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(boosterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === booster.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"], sourceUid: booster.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === booster.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === booster.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: booster.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === attackTarget.uid), restored.session.state)).toBe(3100);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === defenseDecoy.uid), restored.session.state)).toBe(1700);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === attackTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: attackTarget.uid, value: 1500 },
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
      { eventName: "released", eventCode: 1017, eventCardUid: booster.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: booster.uid, eventReasonEffectId: 1 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: booster.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: booster.uid, eventReasonEffectId: 1 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === attackTarget.uid), restoredAfter.session.state)).toBe(3100);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Second Booster");
  expect(script).toContain("e1:SetCost(Cost.SelfTribute)");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsPosition,tp,LOCATION_MZONE,0,1,e:GetHandler(),POS_FACEUP_ATTACK)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsPosition,tp,LOCATION_MZONE,0,1,1,nil,POS_FACEUP_ATTACK)");
  expect(script).toContain("tc:IsRelateToEffect(e) and tc:IsPosition(POS_FACEUP_ATTACK)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1500)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: boosterCode, name: "Second Booster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 3, attack: 1000, defense: 500 },
    { code: attackTargetCode, name: "Second Booster Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: defenseDecoyCode, name: "Second Booster Defense Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
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

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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
