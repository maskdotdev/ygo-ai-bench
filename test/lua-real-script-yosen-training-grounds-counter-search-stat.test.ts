import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const trainingCode = "27918963";
const normalYosenjuCode = "279189630";
const secondYosenjuCode = "279189631";
const searchYosenjuCode = "279189632";
const specialYosenjuCode = "279189633";
const starterCode = "279189634";
const decoyCode = "279189635";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTrainingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${trainingCode}.lua`));
const counterYosen = 0x33;
const setYosenju = 0xb3;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceBeastWarrior = 0x400000;
const attributeWind = 0x10;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTrainingScript)("Lua real script Yosen Training Grounds counter search stat", () => {
  it("restores Yosenju summon counters into counter-cost ATK boost and search branches", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${trainingCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards(workspace));

    const normalCounter = createRestoredScenario("normalCounter", workspace, source, reader);
    expectRestoredLegalActions(normalCounter.restored, 0);
    const normalSummon = getLuaRestoreLegalActions(normalCounter.restored, 0).find((action) =>
      action.type === "normalSummon" && action.uid === normalCounter.normal.uid
    );
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(normalCounter.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(normalCounter.restored, normalSummon!);
    expect(getDuelCardCounter(findCard(normalCounter.restored.session, normalCounter.training.uid), counterYosen)).toBe(1);
    expect(normalCounter.restored.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: normalCounter.normal.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: normalCounter.training.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: normalCounter.training.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);

    const specialCounter = createRestoredScenario("specialCounter", workspace, source, reader);
    expectRestoredLegalActions(specialCounter.restored, 0);
    const specialSummon = getLuaRestoreLegalActions(specialCounter.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === specialCounter.starter.uid
    );
    expect(specialSummon, JSON.stringify(getLuaRestoreLegalActions(specialCounter.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(specialCounter.restored, specialSummon!);
    resolveRestoredChain(specialCounter.restored);
    expect(getDuelCardCounter(findCard(specialCounter.restored.session, specialCounter.training.uid), counterYosen)).toBe(1);
    expect(findCard(specialCounter.restored.session, specialCounter.special.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: specialCounter.starter.uid,
      reasonEffectId: 6,
    });
    expect(specialCounter.restored.session.state.eventHistory.filter((event) => ["specialSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: specialCounter.special.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: specialCounter.starter.uid, eventReasonEffectId: 6, eventReasonPlayer: 0 },
      { eventCardUid: specialCounter.training.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: specialCounter.training.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);

    const boost = createRestoredScenario("boost", workspace, source, reader);
    expectRestoredLegalActions(boost.restored, 0);
    const boostAction = getLuaRestoreLegalActions(boost.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === boost.training.uid && action.effectId === "lua-5"
    );
    expect(boostAction, JSON.stringify(getLuaRestoreLegalActions(boost.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(boost.restored, boostAction!);
    expect(getDuelCardCounter(findCard(boost.restored.session, boost.training.uid), counterYosen)).toBe(0);
    resolveRestoredChain(boost.restored);
    expect(currentAttack(findCard(boost.restored.session, boost.normal.uid), boost.restored.session.state)).toBe(1800);
    expect(currentAttack(findCard(boost.restored.session, boost.second.uid), boost.restored.session.state)).toBe(1500);
    expect(currentAttack(findCard(boost.restored.session, boost.decoy.uid), boost.restored.session.state)).toBe(900);
    expect(boost.restored.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectOption", player: 0, returned: 0 }]);
    expect(boost.restored.session.state.effects.filter((effect) =>
      [boost.normal.uid, boost.second.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: boost.normal.uid, value: 300 },
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: boost.second.uid, value: 300 },
    ]);
    expect(boost.restored.session.state.eventHistory.filter((event) => event.eventName === "counterRemoved").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: boost.training.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.cost, eventReasonCardUid: boost.training.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
    ]);

    const search = createRestoredScenario("search", workspace, source, reader);
    expectRestoredLegalActions(search.restored, 0);
    const searchAction = getLuaRestoreLegalActions(search.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === search.training.uid && action.effectId === "lua-5"
    );
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(search.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(search.restored, searchAction!);
    expect(getDuelCardCounter(findCard(search.restored.session, search.training.uid), counterYosen)).toBe(0);
    resolveRestoredChain(search.restored);
    expect(findCard(search.restored.session, search.searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: search.training.uid,
      reasonEffectId: 5,
    });
    expect(search.restored.host.messages).toContain(`confirmed 1: ${searchYosenjuCode}`);
    expect(search.restored.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectOption", player: 0, returned: 0 }]);
    expect(search.restored.session.state.eventHistory.filter((event) =>
      ["counterRemoved", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: search.training.uid, eventCode: 0x20000, eventName: "counterRemoved", eventPlayer: undefined, eventReason: duelReason.cost, eventReasonCardUid: search.training.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
      { eventCardUid: search.searchTarget.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: search.training.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
      { eventCardUid: search.searchTarget.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: search.training.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
      { eventCardUid: search.searchTarget.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: search.training.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
    ]);
    expect(search.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

type ScriptSource = { readScript(name: string): string | undefined };
type Scenario = "normalCounter" | "specialCounter" | "boost" | "search";

function createRestoredScenario(
  scenario: Scenario,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  source: ScriptSource,
  reader: ReturnType<typeof createCardReader>,
): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  training: DuelCardInstance;
  normal: DuelCardInstance;
  second: DuelCardInstance;
  searchTarget: DuelCardInstance;
  special: DuelCardInstance;
  starter: DuelCardInstance;
  decoy: DuelCardInstance;
} {
  const session = createDuel({ seed: Number(trainingCode) + scenario.length, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [trainingCode, normalYosenjuCode, secondYosenjuCode, searchYosenjuCode, specialYosenjuCode, starterCode, decoyCode] }, 1: { main: [] } });
  startDuel(session);

  const training = requireCard(session, trainingCode);
  const normal = requireCard(session, normalYosenjuCode);
  const second = requireCard(session, secondYosenjuCode);
  const searchTarget = requireCard(session, searchYosenjuCode);
  const special = requireCard(session, specialYosenjuCode);
  const starter = requireCard(session, starterCode);
  const decoy = requireCard(session, decoyCode);
  moveFaceUpSpell(session, training);

  if (scenario === "normalCounter") {
    moveDuelCard(session.state, normal.uid, "hand", 0);
  } else if (scenario === "specialCounter") {
    moveFaceUpMonster(session, starter, 0);
    moveDuelCard(session.state, special.uid, "hand", 0);
  } else if (scenario === "boost") {
    training.counters = { [counterYosen]: 1 };
    moveFaceUpMonster(session, normal, 0);
    moveFaceUpMonster(session, second, 0);
    moveFaceUpMonster(session, decoy, 0);
  } else {
    training.counters = { [counterYosen]: 3 };
    moveDuelCard(session.state, searchTarget.uid, "graveyard", 0).faceUp = true;
  }

  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(trainingCode), source).ok).toBe(true);
  if (scenario === "specialCounter") expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(scenario === "specialCounter" ? 2 : 1);

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  expectCleanRestore(restored);
  return { restored, training, normal, second, searchTarget, special, starter, decoy };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("c:EnableCounterPermit(0x33)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("eg:IsExists(aux.FaceupFilter(Card.IsSetCard,SET_YOSENJU),1,nil)");
  expect(script).toContain("e:GetHandler():AddCounter(0x33,1)");
  expect(script).toContain("e:GetHandler():IsCanRemoveCounter(tp,0x33,1,REASON_COST)");
  expect(script).toContain("e:GetHandler():IsCanRemoveCounter(tp,0x33,3,REASON_COST)");
  expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,1),aux.Stringid(id,2))");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x33,1,REASON_COST)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x33,3,REASON_COST)");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter1,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(300)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.filter2),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const training = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === trainingCode);
  expect(training).toBeDefined();
  return [
    { ...training!, kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: normalYosenjuCode, name: "Yosen Training Normal Yosenju", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, level: 4, attack: 1500, defense: 800, setcodes: [setYosenju] },
    { code: secondYosenjuCode, name: "Yosen Training Second Yosenju", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, level: 4, attack: 1200, defense: 800, setcodes: [setYosenju] },
    { code: searchYosenjuCode, name: "Yosen Training Search Yosenju", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, level: 4, attack: 1400, defense: 1000, setcodes: [setYosenju] },
    { code: specialYosenjuCode, name: "Yosen Training Special Yosenju", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, level: 4, attack: 1600, defense: 1000, setcodes: [setYosenju] },
    { code: starterCode, name: "Yosen Training Special Summoner", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: decoyCode, name: "Yosen Training Non-Yosenju Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${starterCode}.lua`) return starterScript();
      return workspace.readScript(name) ?? workspace.readScript(`official/${name}`);
    },
  };
}

function starterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${specialYosenjuCode}),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
        if tc then Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
      end)
      c:RegisterEffect(e)
    end
  `;
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
