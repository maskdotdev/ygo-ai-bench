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
const interluderCode = "25415161";
const springansXyzCode = "254151610";
const opponentStarterCode = "254151611";
const opponentMonsterCode = "254151612";
const reviveCode = "254151613";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const setSpringans = 0x158;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Springans Interluder chain negate extra stat", () => {
  it("restores Xyz return to Extra into SelectEffect chain negate and leave-field ATK loss trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${interluderCode}.lua`);
    expectScriptShape(script);

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === interluderCode),
      { code: springansXyzCode, name: "Springans Interluder Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, setcodes: [setSpringans], level: 8, attack: 2600, defense: 2000 },
      { code: opponentStarterCode, name: "Interluder Opponent Starter", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: opponentMonsterCode, name: "Interluder Opponent ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2300, defense: 1000 },
      { code: reviveCode, name: "Interluder Level 8 Revive Option", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 2400, defense: 2000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 25415161, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [interluderCode, reviveCode], extra: [springansXyzCode] }, 1: { main: [opponentStarterCode, opponentMonsterCode] } });
    startDuel(session);

    const interluder = requireCard(session, interluderCode);
    const xyz = requireCard(session, springansXyzCode);
    const revive = requireCard(session, reviveCode);
    const starter = requireCard(session, opponentStarterCode);
    const opponent = requireCard(session, opponentMonsterCode);
    moveDuelCard(session.state, interluder.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(session, xyz, 0);
    moveDuelCard(session.state, revive.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, starter, 1);
    moveFaceUpAttack(session, opponent, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${opponentStarterCode}.lua`) return opponentStarterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(interluderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentStarterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredStarter = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredStarter);
    expectRestoredLegalActions(restoredStarter, 1);
    const starterAction = getLuaRestoreLegalActions(restoredStarter, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredStarter, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStarter, starterAction!);
    expect(restoredStarter.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: starter.uid,
        player: 1,
        effectId: "lua-4",
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 1, parameter: 1 }],
      },
    ]);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredStarter.session), source, reader, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 1 }] });
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const interluderAction = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === interluder.uid);
    expect(interluderAction, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, interluderAction!);

    expect(restoredResponse.host.promptDecisions).toContainEqual({
      id: "lua-prompt-1",
      api: "SelectEffect",
      player: 0,
      options: [1, 2],
      descriptions: [406642578, 406642579],
      returned: 1,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === xyz.uid)).toMatchObject({
      controller: 0,
      location: "extraDeck",
      reason: duelReason.effect,
      reasonCardUid: interluder.uid,
      reasonEffectId: 2,
      reasonPlayer: 0,
    });
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["sentToDeck", "chainNegated", "chainDisabled"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventCardUid: xyz.uid, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: interluder.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventValue: undefined },
      { eventCardUid: undefined, eventName: "chainNegated", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, eventValue: 1 },
      { eventCardUid: undefined, eventName: "chainDisabled", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, eventValue: 1 },
    ]);

    passRestoredChain(restoredResponse);
    expect(restoredResponse.host.messages).not.toContain("interluder opponent starter resolved");

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const statTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === interluder.uid);
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, statTrigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === starter.uid)!, restoredTrigger.session.state)).toBe(0);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponent.uid)!, restoredTrigger.session.state)).toBe(1300);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.code === 100 && (effect.sourceUid === starter.uid || effect.sourceUid === opponent.uid)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792 }, sourceUid: starter.uid, value: -1000 },
      { code: 100, reset: { flags: 1107169792 }, sourceUid: opponent.uid, value: -1000 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return rp==1-tp");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOEXTRA,nil,1,tp,LOCATION_MZONE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DISABLE,eg,1,tp,0)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SendtoDeck(sc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.NegateEffect(ev)");
  expect(script).toContain("e3:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("c:IsPreviousPosition(POS_FACEUP) and c:IsPreviousLocation(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-1000)");
}

function opponentStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("interluder opponent starter resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
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
