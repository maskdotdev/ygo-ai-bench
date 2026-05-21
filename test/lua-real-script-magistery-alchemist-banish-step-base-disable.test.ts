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
const alchemistCode = "58270977";
const reviveCode = "582709770";
const earthHeroCode = "582709771";
const waterHeroCode = "582709772";
const fireHeroCode = "582709773";
const windHeroCode = "582709774";
const opponentCode = "582709775";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setHero = 0x8;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeWater = 0x2;
const attributeFire = 0x4;
const attributeWind = 0x8;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Magistery Alchemist banish step base disable", () => {
  it("restores four-attribute HERO banish cost into SpecialSummonStep base ATK double and opponent disable", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${alchemistCode}.lua`);
    expectScriptShape(script);

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === alchemistCode),
      hero(reviveCode, "Magistery Revive HERO", attributeLight, 1800),
      hero(earthHeroCode, "Magistery Earth HERO", attributeEarth, 1000),
      hero(waterHeroCode, "Magistery Water HERO", attributeWater, 1100),
      hero(fireHeroCode, "Magistery Fire HERO", attributeFire, 1200),
      hero(windHeroCode, "Magistery Wind HERO", attributeWind, 1300),
      { code: opponentCode, name: "Magistery Opponent Effect", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2400, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 58270977, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [alchemistCode, earthHeroCode, waterHeroCode, fireHeroCode, windHeroCode, reviveCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const alchemist = requireCard(session, alchemistCode);
    const revive = requireCard(session, reviveCode);
    const earth = requireCard(session, earthHeroCode);
    const water = requireCard(session, waterHeroCode);
    const fire = requireCard(session, fireHeroCode);
    const wind = requireCard(session, windHeroCode);
    const opponent = requireCard(session, opponentCode);
    const setAlchemist = moveDuelCard(session.state, alchemist.uid, "spellTrapZone", 0);
    setAlchemist.faceUp = false;
    setAlchemist.position = "faceDown";
    moveDuelCard(session.state, revive.uid, "graveyard", 0).faceUp = false;
    moveFaceUpAttack(session, earth, 0);
    moveFaceUpAttack(session, water, 0);
    moveFaceUpAttack(session, fire, 0);
    moveFaceUpAttack(session, wind, 0);
    moveFaceUpAttack(session, opponent, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(alchemistCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === alchemist.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    for (const cost of [earth, water, fire, wind]) {
      expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
        location: "banished",
        controller: 0,
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: alchemist.uid,
        reasonEffectId: 1,
      });
    }
    expect(restoredOpen.session.state.cards.find((card) => card.uid === revive.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: alchemist.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === revive.uid)!, restoredOpen.session.state)).toBe(3600);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === revive.uid && effect.code === 103).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 103, reset: { flags: 33427456 }, sourceUid: revive.uid, value: 3600 },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === opponent.uid && [2, 8].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 2, reset: { flags: 33427456, count: 1 }, sourceUid: opponent.uid, value: undefined },
      { code: 8, reset: { flags: 33427456, count: 1 }, sourceUid: opponent.uid, value: 131072 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: earth.uid, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: alchemist.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: water.uid, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: alchemist.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: fire.uid, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: alchemist.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: wind.uid, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: alchemist.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: earth.uid, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: alchemist.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: revive.uid, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: alchemist.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE+CATEGORY_DISABLE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("return Duel.GetMZoneCount(tp,sg)>0 and Duel.IsExistingTarget(s.spfilter,tp,LOCATION_GRAVE,0,1,sg,e,tp)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,4,4,s.spcheck,0)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,4,4,s.spcheck,1,tp,HINTMSG_REMOVE)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,true,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_BASE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetBaseAttack()*2)");
  expect(script).toContain("tcn:NegateEffects(c,nil,true)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  const operationInfos = ["Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,tp,LOCATION_GRAVE)"];
  expect(operationInfos.every((snippet) => script.includes(snippet))).toBe(true);
}

function hero(code: string, name: string, attribute: number, attack: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setHero], race: raceWarrior, attribute, level: 4, attack, defense: 1000 };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
