import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const moonCode = "97452817";
const tokenCode = "97452818";
const decoyCode = "974528170";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMoonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${moonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryCoin = 0x1000000;
const categorySpecialSummon = 0x200;
const categoryToken = 0x400;
const categoryControl = 0x2000;
const eventCoinTossed = 1151;
const eventControlChanged = 1120;

describe.skipIf(!hasUpstreamScripts || !hasMoonScript)("Lua real script Arcana Force Moon coin token control", () => {
  it("restores Arcana coin-result registration into heads Standby token summon and tails End Phase control transfer", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${moonCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const heads = createResolvedCoinWindow({ seed: 151, reader, workspace });
    expect(heads.session.state.lastCoinResults).toEqual([1]);
    expectCleanRestore(heads);
    expectRestoredLegalActions(heads, 0);
    expect(heads.session.state.effects.filter((effect) => effect.sourceUid === requireCard(heads.session, moonCode).uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryCoin, code: 1100, countLimit: undefined, sourceUid: requireCard(heads.session, moonCode).uid, triggerEvent: "normalSummoned" },
      { category: categoryCoin, code: 1102, countLimit: undefined, sourceUid: requireCard(heads.session, moonCode).uid, triggerEvent: "specialSummoned" },
      { category: categoryCoin, code: 1101, countLimit: undefined, sourceUid: requireCard(heads.session, moonCode).uid, triggerEvent: "flipSummoned" },
      { category: categorySpecialSummon + categoryToken, code: 4098, countLimit: 1, sourceUid: requireCard(heads.session, moonCode).uid, triggerEvent: "phaseStandby" },
      { category: categoryControl, code: 4608, countLimit: 1, sourceUid: requireCard(heads.session, moonCode).uid, triggerEvent: "phaseEnd" },
    ]);
    moveToPhaseStart(heads.session, "draw");
    const restoredHeadsDraw = heads;
    expectCleanRestore(restoredHeadsDraw);
    expectRestoredLegalActions(restoredHeadsDraw, 0);
    const standby = getLuaRestoreLegalActions(restoredHeadsDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredHeadsDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHeadsDraw, standby!);
    expect(restoredHeadsDraw.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-4-4098",
        sourceUid: requireCard(restoredHeadsDraw.session, moonCode).uid,
        eventName: "phaseStandby",
        eventCode: 0x1002,
        eventTriggerTiming: "when",
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredHeadsTrigger = restoredHeadsDraw;
    expectCleanRestore(restoredHeadsTrigger);
    expectRestoredLegalActions(restoredHeadsTrigger, 0);
    const tokenTrigger = getLuaRestoreLegalActions(restoredHeadsTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === requireCard(restoredHeadsTrigger.session, moonCode).uid);
    expect(tokenTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredHeadsTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHeadsTrigger, tokenTrigger!);
    expect(restoredHeadsTrigger.session.state.cards.find((card) => card.code === tokenCode)).toMatchObject({
      code: tokenCode,
      location: "monsterZone",
      controller: 0,
      owner: 0,
      position: "faceUpAttack",
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: requireCard(restoredHeadsTrigger.session, moonCode).uid,
      reasonEffectId: 4,
    });

    const tails = createResolvedCoinWindow({ seed: 1, reader, workspace });
    const moon = requireCard(tails.session, moonCode);
    expect(tails.session.state.lastCoinResults).toEqual([0]);
    expectCleanRestore(tails);
    expectRestoredLegalActions(tails, 0);
    moveToPhaseStart(tails.session, "main2");
    const restoredTailsMain2 = tails;
    expectCleanRestore(restoredTailsMain2);
    expectRestoredLegalActions(restoredTailsMain2, 0);
    const end = getLuaRestoreLegalActions(restoredTailsMain2, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(restoredTailsMain2, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTailsMain2, end!);
    expect(restoredTailsMain2.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-5-4608",
        sourceUid: moon.uid,
        eventName: "phaseEnd",
        eventCode: 0x1200,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTailsTrigger = restoredTailsMain2;
    expectCleanRestore(restoredTailsTrigger);
    expectRestoredLegalActions(restoredTailsTrigger, 0);
    const controlTrigger = getLuaRestoreLegalActions(restoredTailsTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === moon.uid);
    expect(controlTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTailsTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTailsTrigger, controlTrigger!);
    expect(restoredTailsTrigger.session.state.cards.find((card) => card.uid === moon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      position: "faceUpAttack",
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: moon.uid,
      reasonEffectId: 5,
    });
    expect(restoredTailsTrigger.session.state.eventHistory.filter((event) => event.eventName === "coinTossed" || event.eventName === "controlChanged")).toEqual([
      {
        eventName: "coinTossed",
        eventCode: eventCoinTossed,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: moon.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "controlChanged",
        eventCode: eventControlChanged,
        eventCardUid: moon.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: moon.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function createResolvedCoinWindow({
  seed,
  reader,
  workspace,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [moonCode, decoyCode] }, 1: { main: [] } });
  startDuel(session);
  const moon = requireCard(session, moonCode);
  const decoy = requireCard(session, decoyCode);
  moveFaceUpAttack(session, decoy, 0, 1);
  session.state.phase = "main1";
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(moonCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  specialSummonDuelCard(session.state, moon.uid, 0);

  const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredTrigger);
  expectRestoredLegalActions(restoredTrigger, 0);
  const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === moon.uid);
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredTrigger, trigger!);
  expect(restoredTrigger.session.state.chain.map((link) => link.operationInfos)).toEqual([]);

  if (restoredTrigger.session.state.chain.length > 0) {
    expectRestoredLegalActions(restoredTrigger, 1);
    const pass = getLuaRestoreLegalActions(restoredTrigger, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, pass!);
  }
  return restoredTrigger;
}

function cards(): DuelCardData[] {
  return [
    { code: moonCode, name: "Arcana Force XVIII - The Moon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2800, defense: 2800 },
    { code: tokenCode, name: "Moon Token", kind: "monster", typeFlags: typeMonster, level: 1, attack: 0, defense: 0 },
    { code: decoyCode, name: "Arcana Moon Control Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1400, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force XVIII - The Moon");
  expect(script).toContain("s.listed_names={97452818}");
  expect(script).toContain("s.toss_coin=true");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
  expect(script).toContain("s.arcanareg(c,Arcana.TossCoin(c,tp))");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())==COIN_HEADS");
  expect(script).toContain("Duel.CreateToken(tp,id+1)");
  expect(script).toContain("Duel.SpecialSummon(token,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())==COIN_TAILS");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,1-tp)");
  expect(script).toContain("Arcana.RegisterCoinResult(c,coin)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveToPhaseStart(session: DuelSession, phase: DuelSession["state"]["phase"]): void {
  session.state.phase = phase;
  session.state.waitingFor = session.state.turnPlayer;
  session.state.chain = [];
  session.state.pendingTriggers = [];
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
