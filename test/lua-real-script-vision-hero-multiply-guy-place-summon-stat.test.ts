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
const multiplyGuyCode = "96693371";
const releaseHeroCode = "966933710";
const opponentCode = "966933711";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMultiplyGuyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${multiplyGuyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const setHero = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasMultiplyGuyScript)("Lua real script Vision HERO Multiply Guy place summon stat", () => {
  it("restores damage trigger placement, S/T release summon, and Special Summon ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${multiplyGuyCode}.lua`));
    const reader = createCardReader(cards());
    const session = createMultiplyGuySession(reader, workspace);
    const multiplyGuy = requireCard(session, multiplyGuyCode);
    const releaseHero = requireCard(session, releaseHeroCode);
    const opponent = requireCard(session, opponentCode);
    moveDuelCard(session.state, multiplyGuy.uid, "graveyard", 0);
    multiplyGuy.faceUp = true;
    moveFaceUpAttack(session, releaseHero, 0);
    moveFaceUpAttack(session, opponent, 1);

    const raised = createLuaScriptHost(session, workspace).loadScript(
      `
        local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${multiplyGuyCode}),0,LOCATION_GRAVE,0,1,1,nil):GetFirst()
        Duel.RaiseEvent(c,EVENT_DAMAGE,nil,REASON_EFFECT,0,0,500)
        Debug.Message("multiply guy damage event raised")
      `,
      "vision-hero-multiply-guy-damage.lua",
    );
    expect(raised.ok, raised.error).toBe(true);

    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredDamage);
    expectRestoredLegalActions(restoredDamage, 0);
    const damageTrigger = getLuaRestoreLegalActions(restoredDamage, 0).find((action) => action.type === "activateTrigger" && action.uid === multiplyGuy.uid);
    expect(damageTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamage, damageTrigger!);
    resolveRestoredChain(restoredDamage);

    expect(restoredDamage.session.state.cards.find((card) => card.uid === multiplyGuy.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(restoredDamage.session.state.effects.filter((effect) => effect.sourceUid === multiplyGuy.uid && effect.code === 117).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: 117, property: 0x400, reset: { flags: 33296384 }, sourceUid: multiplyGuy.uid, value: typeTrap | typeContinuous }]);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(restoredDamage.session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateEffect" && action.uid === multiplyGuy.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === releaseHero.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: multiplyGuy.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === multiplyGuy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expectRestoredLegalActions(restoredSummon, 0);
    const statTrigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === multiplyGuy.uid);
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, statTrigger!);
    resolveRestoredChain(restoredSummon);

    expect(currentAttack(restoredSummon.session.state.cards.find((card) => card.uid === multiplyGuy.uid), restoredSummon.session.state)).toBe(1600);
    expect(currentAttack(restoredSummon.session.state.cards.find((card) => card.uid === opponent.uid), restoredSummon.session.state)).toBe(1500);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === multiplyGuy.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 33427456 }, sourceUid: multiplyGuy.uid, value: 800 }]);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["moved", "released", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: multiplyGuy.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: multiplyGuy.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: releaseHero.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: multiplyGuy.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: releaseHero.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: multiplyGuy.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: multiplyGuy.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: multiplyGuy.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [multiplyGuy.uid],
      },
    ]);
    expect(restoredSummon.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EVENT_DAMAGE)");
  expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_SZONE,POS_FACEUP,true)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_TYPE)");
  expect(script).toContain("e1:SetValue(TYPE_TRAP|TYPE_CONTINUOUS)");
  expect(script).toContain("return Duel.IsMainPhase() and e:GetHandler():IsContinuousTrap()");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.costfilter,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.costfilter,1,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummon(e:GetHandler(),0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
}

function cards(): DuelCardData[] {
  return [
    { code: multiplyGuyCode, name: "Vision HERO Multiply Guy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setHero], race: raceWarrior, attribute: attributeDark, level: 3, attack: 800, defense: 700 },
    { code: releaseHeroCode, name: "Vision HERO Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setHero], race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: opponentCode, name: "Vision HERO Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
  ];
}

function createMultiplyGuySession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 96693371, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [multiplyGuyCode, releaseHeroCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(multiplyGuyCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

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
