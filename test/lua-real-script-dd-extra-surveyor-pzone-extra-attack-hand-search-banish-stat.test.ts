import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { banishDuelCard, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const surveyorCode = "74387963";
const pzoneScaleCode = "743879630";
const dddTargetCode = "743879631";
const destroyedOpponentCode = "743879632";
const extraDdPendulumCode = "743879633";
const extraDecoyCode = "743879634";
const opponentExtraPendulumACode = "743879635";
const opponentExtraPendulumBCode = "743879636";
const opponentDeckACode = "743879637";
const opponentDeckBCode = "743879638";
const ownDdTargetCode = "743879639";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSurveyorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${surveyorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setDd = 0xaf;
const setDdd = 0x10af;
const effectExtraAttack = 194;
const selectYes = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSurveyorScript)("Lua real script D/D Extra Surveyor pzone extra attack hand search banish stat", () => {
  it("restores PZONE banish extra attack, hand Extra Deck retrieval, and banished Deck-top ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${surveyorCode}.lua`));
    const reader = createCardReader(cards(workspace));

    const restoredPzoneTrigger = createRestoredPzoneTrigger({ reader, workspace });
    expectCleanRestore(restoredPzoneTrigger);
    expectRestoredLegalActions(restoredPzoneTrigger, 0);
    const pzoneSurveyor = requireCard(restoredPzoneTrigger.session, surveyorCode);
    const pzoneScale = requireCard(restoredPzoneTrigger.session, pzoneScaleCode);
    const dddTarget = requireCard(restoredPzoneTrigger.session, dddTargetCode);
    const destroyedOpponent = requireCard(restoredPzoneTrigger.session, destroyedOpponentCode);
    expect(restoredPzoneTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1029",
        eventCardUid: destroyedOpponent.uid,
        eventCode: 1029,
        eventName: "destroyed",
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        player: 0,
        sourceUid: pzoneSurveyor.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const pzoneAction = getLuaRestoreLegalActions(restoredPzoneTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === pzoneSurveyor.uid);
    expect(pzoneAction, JSON.stringify(getLuaRestoreLegalActions(restoredPzoneTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPzoneTrigger, pzoneAction!);
    resolveRestoredChain(restoredPzoneTrigger);

    for (const removed of [pzoneSurveyor, pzoneScale]) {
      expect(restoredPzoneTrigger.session.state.cards.find((card) => card.uid === removed.uid)).toMatchObject({
        location: "banished",
        controller: 0,
        faceUp: true,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: pzoneSurveyor.uid,
        reasonEffectId: 3,
      });
    }
    expect(restoredPzoneTrigger.session.state.cards.find((card) => card.uid === dddTarget.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredPzoneTrigger.session.state.effects.filter((effect) => effect.sourceUid === dddTarget.uid && effect.code === effectExtraAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectExtraAttack, property: 0x4000400, reset: { flags: 1107169792 }, sourceUid: dddTarget.uid, value: 1 },
    ]);
    expect(restoredPzoneTrigger.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyedOpponent.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: dddTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, relatedEffectId: 3, previous: "deck", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: pzoneSurveyor.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: pzoneSurveyor.uid, eventReasonEffectId: 3, eventUids: undefined, relatedEffectId: undefined, previous: "spellTrapZone", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: pzoneScale.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: pzoneSurveyor.uid, eventReasonEffectId: 3, eventUids: undefined, relatedEffectId: undefined, previous: "spellTrapZone", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: pzoneSurveyor.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: pzoneSurveyor.uid, eventReasonEffectId: 3, eventUids: [pzoneSurveyor.uid, pzoneScale.uid], relatedEffectId: undefined, previous: "spellTrapZone", current: "banished" },
    ]);

    const restoredHandSearch = createRestoredHandSearch({ reader, workspace });
    expectCleanRestore(restoredHandSearch);
    expectRestoredLegalActions(restoredHandSearch, 0);
    const handSurveyor = requireCard(restoredHandSearch.session, surveyorCode);
    const extraDdPendulum = requireCard(restoredHandSearch.session, extraDdPendulumCode);
    const extraDecoy = requireCard(restoredHandSearch.session, extraDecoyCode);
    const handAction = getLuaRestoreLegalActions(restoredHandSearch, 0).find((action) => action.type === "activateEffect" && action.uid === handSurveyor.uid && action.effectId === "lua-4");
    expect(handAction, JSON.stringify(getLuaRestoreLegalActions(restoredHandSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHandSearch, handAction!);
    resolveRestoredChain(restoredHandSearch);

    expect(restoredHandSearch.session.state.cards.find((card) => card.uid === handSurveyor.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: handSurveyor.uid,
      reasonEffectId: 4,
    });
    expect(restoredHandSearch.session.state.cards.find((card) => card.uid === extraDdPendulum.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: handSurveyor.uid,
      reasonEffectId: 4,
    });
    expect(restoredHandSearch.session.state.cards.find((card) => card.uid === extraDecoy.uid)).toMatchObject({ location: "extraDeck", controller: 0, faceUp: true });
    expect(restoredHandSearch.host.messages).toContain(`confirmed 1: ${extraDdPendulumCode}`);
    expect(restoredHandSearch.session.state.eventHistory.filter((event) => ["discarded", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "discarded", eventCode: 1018, eventCardUid: handSurveyor.uid, eventPlayer: undefined, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: handSurveyor.uid, eventReasonEffectId: 4, previous: "hand", current: "graveyard" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: extraDdPendulum.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: handSurveyor.uid, eventReasonEffectId: 4, previous: "extraDeck", current: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: extraDdPendulum.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: handSurveyor.uid, eventReasonEffectId: 4, previous: "extraDeck", current: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: extraDdPendulum.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: handSurveyor.uid, eventReasonEffectId: 4, previous: "extraDeck", current: "hand" },
    ]);

    const restoredBanishTrigger = createRestoredBanishTrigger({ reader, workspace });
    expectCleanRestore(restoredBanishTrigger);
    expectRestoredLegalActions(restoredBanishTrigger, 0);
    const banishedSurveyor = requireCard(restoredBanishTrigger.session, surveyorCode);
    const opponentDeckA = requireCard(restoredBanishTrigger.session, opponentDeckACode);
    const opponentDeckB = requireCard(restoredBanishTrigger.session, opponentDeckBCode);
    const ownDdTarget = requireCard(restoredBanishTrigger.session, ownDdTargetCode);
    expect(restoredBanishTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-5-1011",
        eventCardUid: banishedSurveyor.uid,
        eventCode: 1011,
        eventName: "banished",
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        player: 0,
        sourceUid: banishedSurveyor.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const banishAction = getLuaRestoreLegalActions(restoredBanishTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === banishedSurveyor.uid);
    expect(banishAction, JSON.stringify(getLuaRestoreLegalActions(restoredBanishTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBanishTrigger, banishAction!);
    resolveRestoredChain(restoredBanishTrigger);

    for (const removed of [opponentDeckA, opponentDeckB]) {
      expect(restoredBanishTrigger.session.state.cards.find((card) => card.uid === removed.uid)).toMatchObject({
        location: "banished",
        controller: 1,
        faceUp: true,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: banishedSurveyor.uid,
        reasonEffectId: 5,
      });
    }
    expect(currentAttack(restoredBanishTrigger.session.state.cards.find((card) => card.uid === ownDdTarget.uid), restoredBanishTrigger.session.state)).toBe(2200);
    expect(restoredBanishTrigger.session.state.cards.find((card) => card.uid === ownDdTarget.uid)).toMatchObject({ attackModifier: 400 });
    expect(restoredBanishTrigger.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1190207411, returned: true },
    ]);
    expect(restoredBanishTrigger.session.state.eventHistory.filter((event) => event.eventName === "banished" || event.eventName === "breakEffect").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: banishedSurveyor.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventUids: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentDeckB.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: banishedSurveyor.uid, eventReasonEffectId: 5, eventUids: undefined, previous: "deck", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentDeckA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: banishedSurveyor.uid, eventReasonEffectId: 5, eventUids: undefined, previous: "deck", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentDeckB.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: banishedSurveyor.uid, eventReasonEffectId: 5, eventUids: [opponentDeckB.uid, opponentDeckA.uid], previous: "deck", current: "banished" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: banishedSurveyor.uid, eventReasonEffectId: 5, eventUids: undefined, previous: undefined, current: undefined },
    ]);
    expect(restoredBanishTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredPzoneTrigger({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 74387963, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [surveyorCode, pzoneScaleCode, dddTargetCode] }, 1: { main: [destroyedOpponentCode] } });
  startDuel(session);
  movePzone(session, requireCard(session, surveyorCode), 0, 0);
  movePzone(session, requireCard(session, pzoneScaleCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, dddTargetCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, destroyedOpponentCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  registerSurveyor(session, workspace);
  const destroyedOpponent = requireCard(session, destroyedOpponentCode);
  destroyDuelCard(session.state, destroyedOpponent.uid, 1, duelReason.effect | duelReason.destroy, 0);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredHandSearch({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 743879630, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [surveyorCode], extra: [extraDdPendulumCode, extraDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, surveyorCode).uid, "hand", 0);
  moveFaceUpExtra(session, requireCard(session, extraDdPendulumCode), 0, 0);
  moveFaceUpExtra(session, requireCard(session, extraDecoyCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  registerSurveyor(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBanishTrigger({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 743879631, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [surveyorCode, ownDdTargetCode] },
    1: { main: [opponentDeckACode, opponentDeckBCode], extra: [opponentExtraPendulumACode, opponentExtraPendulumBCode] },
  });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, surveyorCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ownDdTargetCode), 0, 1);
  moveFaceUpExtra(session, requireCard(session, opponentExtraPendulumACode), 1, 0);
  moveFaceUpExtra(session, requireCard(session, opponentExtraPendulumBCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  registerSurveyor(session, workspace, { promptOverrides: selectYes });
  banishDuelCard(session.state, requireCard(session, surveyorCode).uid, 0, duelReason.effect, 0);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: selectYes });
}

function registerSurveyor(
  session: DuelSession,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  options: Parameters<typeof createLuaScriptHost>[2] = {},
): void {
  const host = createLuaScriptHost(session, workspace, options);
  expect(host.loadCardScript(Number(surveyorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("D/D Extra Surveyor");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("e1:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("return eg:IsExists(s.rmvconfilter,1,nil,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsAbleToRemove,tp,LOCATION_PZONE,0,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)==2");
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_ATTACK)");
  expect(script).toContain("e2:SetRange(LOCATION_HAND)");
  expect(script).toContain("e2:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_DD) and c:IsAbleToHand() and not c:IsCode(id)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e3:SetCode(EVENT_REMOVE)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsType,TYPE_PENDULUM),tp,0,LOCATION_EXTRA,nil)");
  expect(script).toContain("Duel.GetDecktopGroup(1-tp,ct)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,3))");
  expect(script).toContain("sc:UpdateAttack(200*atk,RESET_EVENT|RESETS_STANDARD,e:GetHandler())");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const surveyor = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === surveyorCode);
  expect(surveyor).toBeDefined();
  const ddPendulum = (code: string, name: string, setcodes = [setDd]): DuelCardData => ({
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect | typePendulum,
    setcodes,
    race: raceFiend,
    attribute: attributeDark,
    level: 4,
    attack: 1600,
    defense: 1000,
    leftScale: 2,
    rightScale: 2,
  });
  const monster = (code: string, name: string, setcodes: number[] = []): DuelCardData => ({
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    setcodes,
    race: raceWarrior,
    attribute: attributeDark,
    level: 4,
    attack: code === ownDdTargetCode ? 1800 : 1200,
    defense: 1000,
  });
  return [
    surveyor!,
    ddPendulum(pzoneScaleCode, "Extra Surveyor PZONE Cost", [setDd]),
    monster(dddTargetCode, "Extra Surveyor D/D/D Target", [setDdd]),
    monster(destroyedOpponentCode, "Extra Surveyor Destroyed Opponent"),
    ddPendulum(extraDdPendulumCode, "Extra Surveyor Face-Up Extra D/D"),
    ddPendulum(extraDecoyCode, "Extra Surveyor Face-Up Extra Decoy", []),
    ddPendulum(opponentExtraPendulumACode, "Extra Surveyor Opponent Extra Pendulum A"),
    ddPendulum(opponentExtraPendulumBCode, "Extra Surveyor Opponent Extra Pendulum B"),
    monster(opponentDeckACode, "Extra Surveyor Opponent Deck A"),
    monster(opponentDeckBCode, "Extra Surveyor Opponent Deck B"),
    monster(ownDdTargetCode, "Extra Surveyor Own D/D Target", [setDd]),
  ];
}

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpExtra(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "extraDeck", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
