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
const nikolaCode = "46035545";
const targetCode = "460355450";
const discardCode = "460355451";
const highLevelDecoyCode = "460355452";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNikolaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${nikolaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const setDd = 0xaf;
const setDdd = 0x10af;

describe.skipIf(!hasUpstreamScripts || !hasNikolaScript)("Lua real script D/D Savant Nikola PZone discard stat", () => {
  it("restores Pendulum-zone discard cost into targeted D/D ATK/DEF gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${nikolaCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("e2:SetRange(LOCATION_PZONE)");
    expect(script).toContain("Duel.DiscardHand(tp,s.atkcfilter,1,1,REASON_COST|REASON_DISCARD)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_DD) and c:IsLevelBelow(6)");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(2000)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      { code: nikolaCode, name: "D/D Savant Nikola", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, level: 6, attack: 2000, defense: 2000, leftScale: 8, rightScale: 8, setcodes: [setDd] },
      { code: targetCode, name: "Nikola D/D Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000, setcodes: [setDd] },
      { code: discardCode, name: "Nikola D/D/D Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000, setcodes: [setDdd] },
      { code: highLevelDecoyCode, name: "Nikola High-Level D/D Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 1800, defense: 1500, setcodes: [setDd] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 46035545, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [nikolaCode, targetCode, discardCode, highLevelDecoyCode] }, 1: { main: [] } });
    startDuel(session);

    const nikola = requireCard(session, nikolaCode);
    const target = requireCard(session, targetCode);
    const discard = requireCard(session, discardCode);
    const highLevelDecoy = requireCard(session, highLevelDecoyCode);
    moveDuelCard(session.state, nikola.uid, "spellTrapZone", 0);
    nikola.sequence = 0;
    nikola.faceUp = true;
    nikola.position = "faceUpAttack";
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, highLevelDecoy, 0);
    moveDuelCard(session.state, discard.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(nikolaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === nikola.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: nikola.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(3200);
    expect(currentDefense(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(3000);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === highLevelDecoy.uid), restoredResolved.session.state)).toBe(1800);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792 }, value: 2000 },
      { code: 104, reset: { flags: 1107169792 }, value: 2000 },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "discarded").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "discarded",
        eventCardUid: discard.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: nikola.uid,
        eventReasonEffectId: 4,
      },
    ]);
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
