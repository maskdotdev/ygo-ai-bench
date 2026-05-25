import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const embraceCode = "59069885";
const tistinaDefenderCode = "590698850";
const starterCode = "590698851";
const drawCode = "590698852";
const setTistina = 0x208;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const attributeLight = 0x10;
const raceAqua = 0x40;
const categoryPosition = 0x1000;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Embrace of the Tistina chain set control", () => {
  it("restores monster-effect chain response into turn-set target and End Phase face-down control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${embraceCode}.lua`);
    expect(script).toContain("Duel.SetTargetCard(rc)");
    expect(script).toContain("Duel.ChangePosition(tc,POS_FACEDOWN_DEFENSE)");
    expect(script).toContain("Duel.IsPhase(PHASE_END)");
    expect(script).toContain("Duel.GetControl(tc,tp)");

    const cards: DuelCardData[] = [
      { code: embraceCode, name: "Embrace of the Tistina", kind: "trap", typeFlags: typeTrap | typeContinuous },
      { code: tistinaDefenderCode, name: "Tistina Defense Gate", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeLight, race: raceAqua, level: 10, attack: 0, defense: 3200, setcodes: [setTistina] },
      { code: starterCode, name: "Tistina Opponent Monster Effect Starter", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeLight, race: raceAqua, level: 4, attack: 1600, defense: 1200 },
      { code: drawCode, name: "Tistina Suppressed Draw", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeLight, race: raceAqua, level: 4, attack: 800, defense: 800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 59069885, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [embraceCode, tistinaDefenderCode] }, 1: { main: [starterCode, drawCode] } });
    startDuel(session);

    const embrace = requireCard(session, embraceCode);
    const tistinaDefender = requireCard(session, tistinaDefenderCode);
    const starter = requireCard(session, starterCode);
    const draw = requireCard(session, drawCode);
    moveDuelCard(session.state, embrace.uid, "spellTrapZone", 0).position = "faceUpAttack";
    embrace.faceUp = true;
    moveFaceUpAttack(session, tistinaDefender, 0);
    moveFaceUpAttack(session, starter, 1);
    moveDuelCard(session.state, draw.uid, "deck", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return starterMonsterEffectScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(embraceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const starterAction = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starterAction!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        activationLocation: "monsterZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-4-1002",
        id: "chain-2",
        operationInfos: [{ category: 0x10000, count: 0, parameter: 1, player: 1, targetUids: [] }],
        player: 1,
        sourceUid: starter.uid,
      },
    ]);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const setResponse = getLuaRestoreLegalActions(restoredResponse, 0).find((action) =>
      action.type === "activateEffect" && action.uid === embrace.uid && action.effectId === "lua-2-1027"
    );
    expect(setResponse, JSON.stringify({
      chain: restoredResponse.session.state.chain,
      waitingFor: restoredResponse.session.state.waitingFor,
      effects: restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === embrace.uid),
      actions: getLuaRestoreLegalActions(restoredResponse, 0),
      p1Actions: getLuaRestoreLegalActions(restoredResponse, 1),
    }, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, setResponse!);
    expect(restoredResponse.session.state.chain).toEqual([
      expect.objectContaining({ chainIndex: 1, effectId: "lua-4-1002", player: 1, sourceUid: starter.uid }),
      expect.objectContaining({
        activationLocation: "spellTrapZone",
        chainIndex: 2,
        effectId: "lua-2-1027",
        operationInfos: [{ category: categoryPosition, count: 1, parameter: 8, player: 0, targetUids: [starter.uid] }],
        player: 0,
        sourceUid: embrace.uid,
        targetUids: [starter.uid],
      }),
    ]);

    const restoredSetChain = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredSetChain);
    expectRestoredLegalActions(restoredSetChain, 1);
    resolveRestoredChain(restoredSetChain);
    expect(restoredSetChain.host.messages).toContain("tistina starter resolved");
    expect(restoredSetChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: false,
      position: "faceDownDefense",
    });
    expect(restoredSetChain.session.state.cards.find((card) => card.uid === draw.uid)).toMatchObject({ location: "hand", controller: 1 });

    restoredSetChain.session.state.phase = "end";
    restoredSetChain.session.state.turnPlayer = 1;
    restoredSetChain.session.state.waitingFor = 0;
    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredSetChain.session), source, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    const control = getLuaRestoreLegalActions(restoredEnd, 0).find((action) =>
      action.type === "activateEffect" && action.uid === embrace.uid && action.effectId === "lua-3-1002"
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, control!);
    if (restoredEnd.session.state.prompt) {
      const targetSelection = getLuaRestoreLegalActions(restoredEnd, restoredEnd.session.state.prompt.player).find((action) =>
        action.type === "selectOption" && action.option === starter.fieldId
      );
      expect(targetSelection, JSON.stringify({
        prompt: restoredEnd.session.state.prompt,
        actions: getLuaRestoreLegalActions(restoredEnd, restoredEnd.session.state.prompt.player),
      }, null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restoredEnd, targetSelection!);
    }
    const restoredControlChain = restoreDuelWithLuaScripts(serializeDuel(restoredEnd.session), source, reader);
    expectCleanRestore(restoredControlChain);
    expect(restoredControlChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: false,
      position: "faceDownDefense",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: embrace.uid,
      reasonEffectId: 3,
    });
    expect(restoredControlChain.session.state.eventHistory.filter((event) => ["positionChanged", "controlChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: embrace.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: embrace.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 1, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 1 },
      },
    ]);
  });
});

function starterMonsterEffectScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("tistina starter resolved")
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
