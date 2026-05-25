import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost, type LuaScriptSource } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const bigDipperCode = "89264428";
const summonerCode = "892644280";
const summonedCode = "892644281";
const ursarcticSynchroCode = "892644282";
const graveCostCode = "892644283";
const opponentTargetCode = "892644284";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBigDipperScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bigDipperCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeField = 0x80000;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const setUrsarctic = 0x165;
const counterBigDipper = 0x204;
const categoryControl = 0x2000;
const eventFreeChain = 1002;
const eventSpecialSummonSuccess = 1102;
const effectCounterPermitBigDipper = 0x10000 + counterBigDipper;
const effectCostReplace = 84012625;
const effectFlagPlayerTarget = 0x800;
const effectFlagDelay = 0x10000;
const effectFlagCardTarget = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasBigDipperScript)("Lua real script Ursarctic Big Dipper counter control", () => {
  it("restores Field Spell cost replacement, Special Summon counter placement, and counter-cost control trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const source = withSummoner(workspace);
    expectScriptShape(workspace.readScript(`official/c${bigDipperCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 89264428, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bigDipperCode, ursarcticSynchroCode, graveCostCode] }, 1: { main: [summonerCode, summonedCode, opponentTargetCode] } });
    startDuel(session);

    const bigDipper = requireCard(session, bigDipperCode);
    const ursarcticSynchro = requireCard(session, ursarcticSynchroCode);
    const graveCost = requireCard(session, graveCostCode);
    const summoner = requireCard(session, summonerCode);
    const summoned = requireCard(session, summonedCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    placeFieldSpell(session, bigDipper);
    bigDipper.counters = { [counterBigDipper]: 7 };
    moveFaceUpAttack(session, ursarcticSynchro, 0, 0);
    moveDuelCard(session.state, graveCost.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, summoner, 1, 1);
    moveDuelCard(session.state, summoned.uid, "hand", 1);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    prepareMainPhase(session, 1);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bigDipperCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(summonerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const summon = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === summoner.uid);
    expect(summon, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, summon!);
    resolveChain(session);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === bigDipper.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: effectCounterPermitBigDipper, countLimit: undefined, event: "continuous", id: `lua-1-${effectCounterPermitBigDipper}`, property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: eventFreeChain, countLimit: undefined, event: "ignition", id: `lua-2-${eventFreeChain}`, property: undefined, range: ["hand", "spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: effectCostReplace, countLimit: 1, event: "continuous", id: `lua-3-${effectCostReplace}`, property: effectFlagPlayerTarget, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: eventSpecialSummonSuccess, countLimit: undefined, event: "continuous", id: `lua-4-${eventSpecialSummonSuccess}`, property: undefined, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: categoryControl, code: eventSpecialSummonSuccess, countLimit: 1, event: "trigger", id: `lua-5-${eventSpecialSummonSuccess}`, property: effectFlagDelay | effectFlagCardTarget, range: ["spellTrapZone"], triggerEvent: "specialSummoned" },
    ]);
    expect(getDuelCardCounter(findCard(restored.session, bigDipper.uid), counterBigDipper)).toBe(8);
    expectRestoredLegalActions(restored, 0);
    const control = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === bigDipper.uid && action.effectId === `lua-5-${eventSpecialSummonSuccess}`
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, control!);
    resolveRestoredChain(restored);

    expect(getDuelCardCounter(findCard(restored.session, bigDipper.uid), counterBigDipper)).toBe(0);
    expect(findCard(restored.session, opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: bigDipper.uid,
      reasonEffectId: 5,
    });
    expect(findCard(restored.session, graveCost.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => ["counterAdded", "counterRemoved", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterAdded", eventCardUid: bigDipper.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: bigDipper.uid, eventReasonEffectId: 4 },
      { eventName: "counterRemoved", eventCardUid: bigDipper.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: bigDipper.uid, eventReasonEffectId: 5 },
      { eventName: "controlChanged", eventCardUid: opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: bigDipper.uid, eventReasonEffectId: 5 },
    ]);
  });
});

function withSummoner(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): LuaScriptSource {
  return {
    readScript(name) {
      if (name === `c${summonerCode}.lua`) return summonerScript();
      return workspace.readScript(name);
    },
  };
}

function summonerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_HAND,0,1,nil,${summonedCode}) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(Card.IsCode,tp,LOCATION_HAND,0,nil,${summonedCode})
        if tc then Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    { code: bigDipperCode, name: "Ursarctic Big Dipper", kind: "spell", typeFlags: typeSpell | typeField, setcodes: [setUrsarctic] },
    { code: ursarcticSynchroCode, name: "Ursarctic Synchro", kind: "monster", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceBeast, attribute: attributeWater, setcodes: [setUrsarctic], level: 7, attack: 2400, defense: 1600 },
    { code: graveCostCode, name: "Ursarctic Grave Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeWater, setcodes: [setUrsarctic], level: 7, attack: 2200, defense: 1400 },
    { code: summonerCode, name: "Big Dipper Opponent Summoner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: summonedCode, name: "Big Dipper Summoned Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTargetCode, name: "Big Dipper Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ursarctic Big Dipper");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_BIG_DIPPER)");
  expect(script).toContain("e1:SetCode(EFFECT_COST_REPLACE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.repconfilter,tp,LOCATION_GRAVE,0,1,1,nil");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST|REASON_REPLACE)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_BIG_DIPPER,1)");
  expect(script).toContain("e3:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("c:RemoveCounter(tp,COUNTER_BIG_DIPPER,c:GetCounter(COUNTER_BIG_DIPPER),REASON_COST)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
}

function prepareMainPhase(session: DuelSession, player: PlayerId): void {
  session.state.phase = "main1";
  session.state.turnPlayer = player;
  session.state.waitingFor = player;
}

function placeFieldSpell(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}

function resolveChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
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
