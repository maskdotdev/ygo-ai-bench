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
const titanoCode = "85028288";
const costCode = "850282880";
const decoyCode = "850282881";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTitanoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${titanoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDinosaur = 0x10000;
const attributeFire = 0x4;
const setJurrac = 0x22;
const effectSpecialSummonCondition = 30;
const effectCannotBeEffectTarget = 71;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasTitanoScript)("Lua real script Jurrac Titano banish protect stat", () => {
  it("restores special-summon condition, Trap-monster targeting protection, and banish-cost ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${titanoCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 85028288, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [titanoCode, costCode, decoyCode] }, 1: { main: [] } });
    startDuel(session);

    const titano = requireCard(session, titanoCode);
    const cost = requireCard(session, costCode);
    const decoy = requireCard(session, decoyCode);
    moveFaceUpAttack(session, titano, 0);
    moveDuelCard(session.state, cost.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, decoy, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(titanoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === titano.uid && [effectSpecialSummonCondition, effectCannotBeEffectTarget].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSpecialSummonCondition, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: titano.uid, value: undefined },
      { code: effectCannotBeEffectTarget, event: "continuous", property: 0x20000, range: ["monsterZone"], sourceUid: titano.uid, value: undefined },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === titano.uid && candidate.effectId === "lua-3",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: titano.uid,
      reasonEffectId: 3,
    });
    expect(restored.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "monsterZone" });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === titano.uid), restored.session.state)).toBe(4000);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === titano.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: 1107235328 }, sourceUid: titano.uid, value: 1000 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: cost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: titano.uid, eventReasonEffectId: 3 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === titano.uid), restoredAfter.session.state)).toBe(4000);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Jurrac Titano");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("return re:GetHandler():IsType(TYPE_TRAP+TYPE_MONSTER)");
  expect(script).toContain("return c:IsAttackBelow(1700) and c:IsSetCard(SET_JURRAC) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,e:GetHandler())");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: titanoCode, name: "Jurrac Titano", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeFire, level: 9, attack: 3000, defense: 2800, setcodes: [setJurrac] },
    { code: costCode, name: "Jurrac Titano Grave Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeFire, level: 4, attack: 1600, defense: 1000, setcodes: [setJurrac] },
    { code: decoyCode, name: "Jurrac Titano High ATK Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeFire, level: 4, attack: 1800, defense: 1000, setcodes: [setJurrac] },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
