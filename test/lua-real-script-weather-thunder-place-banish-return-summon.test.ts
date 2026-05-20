import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const thunderCode = "91299846";
const hasThunderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${thunderCode}.lua`));
const costContinuousCode = "91299847";
const placedWeatherCode = "91299848";
const offSetDeckDecoyCode = "91299849";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const setTheWeather = 0x109;

describe.skipIf(!hasUpstreamScripts || !hasThunderScript)("Lua real script Weather Painter Thunder place return summon", () => {
  it("restores continuous-cost placement and pins banished next-Standby self-return registration", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${thunderCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_CONTINUOUS) and c:IsAbleToGraveAsCost()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_ONFIELD,0,1,1,nil,tp)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("Duel.MoveToField(tc,tp,tp,LOCATION_SZONE,POS_FACEUP,true)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e2:SetCode(EVENT_REMOVE)");
    expect(script).toContain("if c:IsReason(REASON_COST) and rc:IsSetCard(SET_THE_WEATHER) then");
    expect(script).toContain("e:SetLabel(Duel.GetTurnCount()+1)");
    expect(script).toContain("c:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,2)");
    expect(script).toContain("e3:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("return e:GetLabelObject():GetLabel()==Duel.GetTurnCount() and e:GetHandler():GetFlagEffect(id)>0");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: thunderCode, name: "The Weather Painter Thunder", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTheWeather], level: 3, attack: 1700, defense: 0 },
      { code: costContinuousCode, name: "Weather Continuous Cost", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setTheWeather] },
      { code: placedWeatherCode, name: "Weather Deck Canvas", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setTheWeather] },
      { code: offSetDeckDecoyCode, name: "Weather Off-Set Deck Decoy", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [0x123] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 91299846, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [thunderCode, costContinuousCode, offSetDeckDecoyCode, placedWeatherCode] }, 1: { main: [] } });
    startDuel(session);

    const thunder = requireCard(session, thunderCode);
    const costContinuous = requireCard(session, costContinuousCode);
    const placedWeather = requireCard(session, placedWeatherCode);
    const offSetDeckDecoy = requireCard(session, offSetDeckDecoyCode);
    moveFaceUp(session, thunder.uid, "monsterZone", 0);
    moveFaceUp(session, costContinuous.uid, "spellTrapZone", 0);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(thunderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const place = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === thunder.uid);
    expect(place, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, place!);
    expect(session.state.cards.find((card) => card.uid === costContinuous.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonCardUid: thunder.uid,
      reasonEffectId: 1,
    });
    expect(session.state.chain).toEqual([]);

    const restoredPlace = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredPlace);
    expectRestoredLegalActions(restoredPlace, 0);
    expect(restoredPlace.session.state.cards.find((card) => card.uid === placedWeather.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(restoredPlace.session.state.cards.find((card) => card.uid === offSetDeckDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredPlace.session.state.eventHistory.map((event) => event.eventName)).toEqual([
      "leftField",
      "moved",
      "sentToGraveyard",
      "chainActivating",
      "chaining",
      "chainSolving",
      "moved",
      "chainSolved",
      "chainEnded",
    ]);
    expect(restoredPlace.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === costContinuous.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: costContinuous.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: thunder.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restoredPlace.session.state.eventHistory.filter((event) => event.eventName === "moved" && event.eventCardUid === placedWeather.uid)).toEqual([
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: placedWeather.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: thunder.uid,
        eventReasonEffectId: 1,
      },
    ]);

    expect(restoredPlace.session.state.effects.filter((effect) => effect.sourceUid === thunder.uid).map((effect) => effect.code)).toEqual([
      undefined,
      1011,
      0x1002,
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUp(session: DuelSession, uid: string, location: "monsterZone" | "spellTrapZone", controller: 0 | 1): void {
  const card = moveDuelCard(session.state, uid, location, controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
