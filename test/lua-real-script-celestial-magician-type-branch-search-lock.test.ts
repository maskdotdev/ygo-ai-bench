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
const celestialCode = "58092907";
const fusionCode = "580929070";
const synchroCode = "580929071";
const xyzCode = "580929072";
const pendulumAllyCode = "580929073";
const pendulumSearchCode = "580929074";
const nonPendulumDecoyCode = "580929075";
const responderCode = "580929076";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCelestialScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${celestialCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeSynchro = 0x2000;
const typeXyz = 0x800000;
const typePendulum = 0x1000000;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasCelestialScript)("Lua real script Performapal Celestial Magician type branch search lock", () => {
  it("restores summoned-turn type branches into direct attack, monster-effect lock, final ATK, and End Phase Pendulum search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${celestialCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("aux.GlobalCheck(s,function()");
    expect(script).toContain("ge1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("ge1:SetOperation(aux.sumreg)");
    expect(script).toContain("return e:GetHandler():GetFlagEffect(id)>0");
    expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsType,TYPE_FUSION+TYPE_SYNCHRO+TYPE_XYZ+TYPE_PENDULUM),tp,LOCATION_MZONE,0,c)");
    expect(script).toContain("e1:SetCode(EFFECT_DIRECT_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ACTIVATE)");
    expect(script).toContain("return re:IsMonsterEffect()");
    expect(script).toContain("e3:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e3:SetValue(c:GetBaseAttack()*2)");
    expect(script).toContain("e4:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      { code: celestialCode, name: "Performapal Celestial Magician", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1500, defense: 1000, leftScale: 8, rightScale: 8 },
      { code: fusionCode, name: "Celestial Fusion Ally", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 6, attack: 2200, defense: 1800 },
      { code: synchroCode, name: "Celestial Synchro Ally", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, level: 7, attack: 2400, defense: 2000 },
      { code: xyzCode, name: "Celestial Xyz Ally", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 4, attack: 2100, defense: 1600 },
      { code: pendulumAllyCode, name: "Celestial Pendulum Ally", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, level: 4, attack: 1700, defense: 1000, leftScale: 3, rightScale: 3 },
      { code: pendulumSearchCode, name: "Celestial Pendulum Search", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, level: 4, attack: 1200, defense: 1000, leftScale: 2, rightScale: 2 },
      { code: nonPendulumDecoyCode, name: "Celestial Non-Pendulum Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Celestial Opponent Monster Effect", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 58092907, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [celestialCode, pendulumAllyCode, pendulumSearchCode, nonPendulumDecoyCode], extra: [fusionCode, synchroCode, xyzCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const celestial = requireCard(session, celestialCode);
    const fusion = requireCard(session, fusionCode);
    const synchro = requireCard(session, synchroCode);
    const xyz = requireCard(session, xyzCode);
    const pendulumAlly = requireCard(session, pendulumAllyCode);
    const pendulumSearch = requireCard(session, pendulumSearchCode);
    const nonPendulumDecoy = requireCard(session, nonPendulumDecoyCode);
    const responder = requireCard(session, responderCode, 1);
    moveDuelCard(session.state, celestial.uid, "hand", 0);
    moveFaceUpAttack(session, fusion, 0);
    moveFaceUpAttack(session, synchro, 0);
    moveFaceUpAttack(session, xyz, 0);
    moveFaceUpAttack(session, pendulumAlly, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(celestialCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const normalSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === celestial.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, normalSummon!);

    const restoredSummoned = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredSummoned);
    expectRestoredLegalActions(restoredSummoned, 0);
    expect(restoredSummoned.session.state.flagEffects.filter((flag) => flag.ownerType === "card" && flag.ownerId === celestial.uid && flag.code === Number(celestialCode)).map((flag) => ({
      code: flag.code,
      reset: flag.reset,
      property: flag.property,
      value: flag.value,
    }))).toEqual([{ code: Number(celestialCode), reset: 1107169792, property: 0, value: 0 }]);
    const ignition = getLuaRestoreLegalActions(restoredSummoned, 0).find((action) => action.type === "activateEffect" && action.uid === celestial.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredSummoned, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummoned, ignition!);
    expect(restoredSummoned.session.state.chain).toEqual([
      {
        id: "chain-4",
        chainIndex: 1,
        effectId: "lua-4",
        sourceUid: celestial.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 4,
      },
    ]);
    expect(restoredSummoned.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredSummoned);

    const restoredBranched = restoreDuelWithLuaScripts(serializeDuel(restoredSummoned.session), source, reader);
    expectCleanRestore(restoredBranched);
    expectRestoredLegalActions(restoredBranched, 0);
    expect(currentAttack(restoredBranched.session.state.cards.find((card) => card.uid === celestial.uid), restoredBranched.session.state)).toBe(3000);
    expect(restoredBranched.session.state.effects.filter((effect) => effect.sourceUid === celestial.uid && [6, 74, 102, phaseEndEventCode].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: 74, event: "continuous", property: 0x4000000, reset: { flags: 1107169792 }, targetRange: undefined, triggerEvent: undefined, value: 1 },
      { code: 6, event: "continuous", property: 0x800, reset: { flags: 1107165696 }, targetRange: [0, 1], triggerEvent: undefined, value: undefined },
      { code: 102, event: "continuous", property: undefined, reset: { flags: 1107235328 }, targetRange: undefined, triggerEvent: undefined, value: 3000 },
      { code: phaseEndEventCode, event: "continuous", property: undefined, reset: { flags: 1073742336 }, targetRange: undefined, triggerEvent: "phaseEnd", value: undefined },
    ]);

    restoredBranched.session.state.phase = "battle";
    restoredBranched.session.state.waitingFor = 0;
    const battleActions = getLuaRestoreLegalActions(restoredBranched, 0);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === celestial.uid && action.directAttack === true)).toBe(true);

    restoredBranched.session.state.phase = "main1";
    restoredBranched.session.state.turnPlayer = 1;
    restoredBranched.session.state.waitingFor = 1;
    const opponentActions = getLuaRestoreLegalActions(restoredBranched, 1);
    expect(opponentActions.some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(false);

    restoredBranched.session.state.phase = "main2";
    restoredBranched.session.state.turnPlayer = 0;
    restoredBranched.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredBranched, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredBranched, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBranched, endPhase!);

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredBranched.session), source, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    const endTurn = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "endTurn");
    expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, endTurn!);
    const restoredSearch = restoredEnd;
    expect(restoredSearch.session.state.cards.find((card) => card.uid === pendulumSearch.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: celestial.uid,
      reasonEffectId: 11,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === nonPendulumDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["normalSummoned", "phaseEnd", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: celestial.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 4 },
      },
      sentToHandEvent(pendulumSearch.uid, celestial.uid, 1),
      confirmedEvent(pendulumSearch.uid, celestial.uid, 1),
      sentToHandConfirmedEvent(pendulumSearch.uid, celestial.uid, 1),
      { eventName: "phaseEnd", eventCode: phaseEndEventCode },
    ]);
  });
});

function sentToHandEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 11,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 11,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 11,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
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
  const player = restored.session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("celestial responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
