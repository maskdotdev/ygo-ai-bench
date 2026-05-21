import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const promCode = "79905468";
const hasPromScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${promCode}.lua`));
const dragonTargetCode = "799054680";
const normalMonsterCode = "799054681";
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasPromScript)("Lua real script Guardragon Promineses stat and redirect summon", () => {
  it("restores SelfToGrave Dragon stat boost and grouped Normal monster to-GY self summon with leave-field redirect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${promCode}.lua`);
    expect(script).toContain("e1:SetCost(Cost.SelfToGrave)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsRace,RACE_DRAGON),tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("local ct=Duel.IsTurnPlayer(tp) and 2 or 1");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY,EFFECT_FLAG2_CHECK_SIMULTANEOUS)");
    expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return not eg:IsContains(e:GetHandler()) and eg:IsExists(s.cfilter,1,nil,tp)");
    expect(script).toContain("return c:IsControler(tp) and c:IsType(TYPE_NORMAL)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
    expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
    expect(script).toContain("e1:SetValue(LOCATION_REMOVED)");

    const cards: DuelCardData[] = [
      { code: promCode, name: "Guardragon Promineses", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 1, attack: 500, defense: 200 },
      { code: dragonTargetCode, name: "Promineses Dragon Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 4, attack: 1500, defense: 1200 },
      { code: normalMonsterCode, name: "Promineses Normal Trigger Monster", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);

    const statSession = createDuel({ seed: 79905468, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [promCode, dragonTargetCode] }, 1: { main: [] } });
    startDuel(statSession);
    const statProm = requireCard(statSession, promCode);
    const dragonTarget = requireCard(statSession, dragonTargetCode);
    moveDuelCard(statSession.state, statProm.uid, "hand", 0);
    const dragon = moveDuelCard(statSession.state, dragonTarget.uid, "monsterZone", 0);
    dragon.faceUp = true;
    dragon.position = "faceUpAttack";
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;
    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(promCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statAction = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "activateEffect" && action.uid === statProm.uid);
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStat, statAction!);
    expect(restoredStat.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredStat.session.state.cards.find((card) => card.uid === statProm.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statProm.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === dragonTarget.uid), restoredStat.session.state)).toBe(2000);
    expect(currentDefense(restoredStat.session.state.cards.find((card) => card.uid === dragonTarget.uid), restoredStat.session.state)).toBe(1700);
    expect(restoredStat.session.state.effects.filter((effect) => [100, 104].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792, count: 2 }, sourceUid: dragonTarget.uid, value: 500 },
      { code: 104, reset: { flags: 1107169792, count: 2 }, sourceUid: dragonTarget.uid, value: 500 },
    ]);

    const summonSession = createDuel({ seed: 79905469, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [promCode, normalMonsterCode] }, 1: { main: [] } });
    startDuel(summonSession);
    const summonProm = requireCard(summonSession, promCode);
    const normalMonster = requireCard(summonSession, normalMonsterCode);
    moveDuelCard(summonSession.state, summonProm.uid, "graveyard", 0);
    const normal = moveDuelCard(summonSession.state, normalMonster.uid, "monsterZone", 0);
    normal.faceUp = true;
    normal.position = "faceUpAttack";
    summonSession.state.phase = "main1";
    summonSession.state.turnPlayer = 0;
    summonSession.state.waitingFor = 0;
    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(promCode), workspace).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(1);
    sendDuelCardToGraveyard(summonSession.state, normalMonster.uid, 0, duelReason.effect, 0);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(summonSession), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toMatchObject([
      {
        effectId: "lua-2-1014",
        sourceUid: summonProm.uid,
        eventName: "sentToGraveyard",
        eventCardUid: normalMonster.uid,
        eventReason: duelReason.effect,
        player: 0,
        triggerBucket: "turnOptional",
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === summonProm.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === summonProm.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonProm.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === summonProm.uid && effect.code === 60)).toEqual([
      expect.objectContaining({
        event: "continuous",
        code: 60,
        value: 0x20,
        range: ["monsterZone"],
      }),
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: normalMonster.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonProm.uid,
        eventUids: [summonProm.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonProm.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredRedirect = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredRedirect);
    expectRestoredLegalActions(restoredRedirect, 0);
    destroyDuelCard(restoredRedirect.session.state, summonProm.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredRedirect.session.state.cards.find((card) => card.uid === summonProm.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect | duelReason.destroy | duelReason.redirect,
      reasonPlayer: 0,
    });
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
