import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { banishDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const clockCode = "51476410";
const hasClockScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${clockCode}.lua`));
const cyberseA = "514764100";
const cyberseB = "514764101";
const opponentSpecialCode = "514764102";
const opponentNormalCode = "514764103";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasClockScript)("Lua real script Clock Lizard banished Cyberse stat", () => {
  it("restores EVENT_REMOVE from Graveyard into Cyberse-count opponent Special Summoned ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${clockCode}.lua`);
    expect(script).toContain("Fusion.CreateSummonEff({handler=c,location=LOCATION_GRAVE");
    expect(script).toContain("extraop=Fusion.BanishMaterial");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOEXTRA,nil,1,tp,LOCATION_GRAVE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_EXTRA)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,nil,1,tp,LOCATION_GRAVE)");
    expect(script).toContain("e2:SetCode(EVENT_REMOVE)");
    expect(script).toContain("c:IsFaceup() and c:IsPreviousLocation(LOCATION_GRAVE)");
    expect(script).toContain("Duel.GetMatchingGroupCount(Card.IsRace,tp,LOCATION_GRAVE,0,nil,RACE_CYBERSE)*400");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-atk)");

    const cards: DuelCardData[] = [
      { code: clockCode, name: "Clock Lizard", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 2, attack: 1200, defense: 3, race: raceCyberse },
      { code: cyberseA, name: "Clock Lizard Cyberse A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, race: raceCyberse },
      { code: cyberseB, name: "Clock Lizard Cyberse B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, race: raceCyberse },
      { code: opponentSpecialCode, name: "Clock Lizard Opponent Special", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1600 },
      { code: opponentNormalCode, name: "Clock Lizard Opponent Normal", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 51476410, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [clockCode], main: [cyberseA, cyberseB] }, 1: { main: [opponentSpecialCode, opponentNormalCode] } });
    startDuel(session);

    const clock = requireCard(session, clockCode);
    const cyberseOne = requireCard(session, cyberseA);
    const cyberseTwo = requireCard(session, cyberseB);
    const special = requireCard(session, opponentSpecialCode);
    const normal = requireCard(session, opponentNormalCode);
    moveDuelCard(session.state, clock.uid, "graveyard", 0);
    moveDuelCard(session.state, cyberseOne.uid, "graveyard", 0);
    moveDuelCard(session.state, cyberseTwo.uid, "graveyard", 0);
    moveDuelCard(session.state, special.uid, "monsterZone", 1).position = "faceUpAttack";
    special.faceUp = true;
    special.summonType = "special";
    moveDuelCard(session.state, normal.uid, "monsterZone", 1).position = "faceUpAttack";
    normal.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(clockCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    banishDuelCard(session.state, clock.uid, 0, duelReason.effect, 0, { eventReasonCardUid: clock.uid, eventReasonEffectId: 1 });
    expect(session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === clock.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: clock.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: clock.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: clock.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: clock.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
        sourceUid: clock.uid,
        effectId: "lua-3-1011",
        player: 0,
        triggerBucket: "turnOptional",
        eventTriggerTiming: "if",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === clock.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === special.uid), restoredTrigger.session.state)).toBe(1600);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === normal.uid), restoredTrigger.session.state)).toBe(1800);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 100 && effect.sourceUid === special.uid).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 1107169792 }, value: -800 }]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
