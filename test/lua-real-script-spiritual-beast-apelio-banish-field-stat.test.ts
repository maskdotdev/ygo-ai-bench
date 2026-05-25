import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const apelioCode = "86396750";
const ritualBeastCostCode = "863967500";
const ritualBeastAllyCode = "863967501";
const decoyCode = "863967502";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasApelioScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${apelioCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePyro = 0x80;
const attributeFire = 0x4;
const setRitualBeast = 0xb5;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasApelioScript)("Lua real script Spiritual Beast Apelio banish field stat", () => {
  it("restores graveyard Ritual Beast banish cost into player-wide Ritual Beast ATK/DEF boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${apelioCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restored = createRestoredApelioOpen({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const apelio = requireCard(restored.session, apelioCode);
    const cost = requireCard(restored.session, ritualBeastCostCode);
    const ally = requireCard(restored.session, ritualBeastAllyCode);
    const decoy = requireCard(restored.session, decoyCode);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === apelio.uid && candidate.effectId.startsWith("lua-1")
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
      reasonCardUid: apelio.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(findCard(restored.session, apelio.uid), restored.session.state)).toBe(2300);
    expect(currentDefense(findCard(restored.session, apelio.uid), restored.session.state)).toBe(900);
    expect(currentAttack(findCard(restored.session, ally.uid), restored.session.state)).toBe(1500);
    expect(currentDefense(findCard(restored.session, ally.uid), restored.session.state)).toBe(1700);
    expect(currentAttack(findCard(restored.session, decoy.uid), restored.session.state)).toBe(1600);
    expect(currentDefense(findCard(restored.session, decoy.uid), restored.session.state)).toBe(1600);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === apelio.uid && [effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1073742336 }, sourceUid: apelio.uid, targetRange: [4, 0], value: 500 },
      { code: effectUpdateDefense, reset: { flags: 1073742336 }, sourceUid: apelio.uid, targetRange: [4, 0], value: 500 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished")).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: cost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: apelio.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    expect(currentAttack(findCard(restoredBoost.session, apelio.uid), restoredBoost.session.state)).toBe(2300);
    expect(currentDefense(findCard(restoredBoost.session, apelio.uid), restoredBoost.session.state)).toBe(900);
    expect(currentAttack(findCard(restoredBoost.session, ally.uid), restoredBoost.session.state)).toBe(1500);
    expect(currentDefense(findCard(restoredBoost.session, ally.uid), restoredBoost.session.state)).toBe(1700);
    expect(currentAttack(findCard(restoredBoost.session, decoy.uid), restoredBoost.session.state)).toBe(1600);
    expect(currentDefense(findCard(restoredBoost.session, decoy.uid), restoredBoost.session.state)).toBe(1600);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: apelioCode, name: "Spiritual Beast Apelio", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, setcodes: [setRitualBeast], level: 4, attack: 1800, defense: 400 },
    { code: ritualBeastCostCode, name: "Apelio Grave Ritual Beast Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, setcodes: [setRitualBeast], level: 4, attack: 1000, defense: 1000 },
    { code: ritualBeastAllyCode, name: "Apelio Ritual Beast Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, setcodes: [setRitualBeast], level: 4, attack: 1000, defense: 1200 },
    { code: decoyCode, name: "Apelio Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePyro, attribute: attributeFire, level: 4, attack: 1600, defense: 1600 },
  ];
}

function createRestoredApelioOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 86396750, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [apelioCode, ritualBeastCostCode, ritualBeastAllyCode, decoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, apelioCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, ritualBeastCostCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, ritualBeastAllyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, decoyCode), 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(apelioCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Spiritual Beast Apelio");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("return c:IsSetCard(SET_RITUAL_BEAST) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("return c:IsSetCard(SET_RITUAL_BEAST)");
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0 && guard < 10) {
    guard += 1;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
  expect(guard).toBeLessThan(10);
}
