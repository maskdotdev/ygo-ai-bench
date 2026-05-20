import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasIgnisScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c22499034.lua"));
const ignisCode = "22499034";
const starterCode = "22499035";
const searchTargetCode = "22499036";
const offTypeDecoyCode = "22499037";
const offSetDecoyCode = "22499038";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const setTrueDracoKing = 0xf9;

describe.skipIf(!hasUpstreamScripts || !hasIgnisScript)("Lua real script Ignis Heat chain search", () => {
  it("restores tribute-summoned Ignis Heat EVENT_CHAINING Continuous Spell search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${ignisCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_ADD_EXTRA_TRIBUTE)");
    expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsType,TYPE_CONTINUOUS))");
    expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
    expect(script).toContain("return e:GetHandler():IsTributeSummoned() and rp~=tp");
    expect(script).toContain("return c:IsSetCard(SET_TRUE_DRACO_KING) and c:IsContinuousSpell()");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.thfilter,tp,LOCATION_DECK,0,1,nil,tp)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil,tp)");
    expect(script).toContain("aux.ToHandOrElse(tc,tp,function(c)");

    const cards: DuelCardData[] = [
      { code: ignisCode, name: "Ignis Heat, the True Dracowarrior", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTrueDracoKing], level: 5, attack: 2400, defense: 1000 },
      { code: starterCode, name: "Ignis Opponent Chain Starter", kind: "spell", typeFlags: typeSpell },
      { code: searchTargetCode, name: "Ignis True Draco Continuous Spell Target", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setTrueDracoKing] },
      { code: offTypeDecoyCode, name: "Ignis True Draco Continuous Trap Decoy", kind: "trap", typeFlags: typeTrap | typeContinuous, setcodes: [setTrueDracoKing] },
      { code: offSetDecoyCode, name: "Ignis Off-Set Continuous Spell Decoy", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [0x123] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 22499034, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ignisCode, searchTargetCode, offTypeDecoyCode, offSetDecoyCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const ignis = requireCard(session, ignisCode);
    const starter = requireCard(session, starterCode);
    const searchTarget = requireCard(session, searchTargetCode);
    const offTypeDecoy = requireCard(session, offTypeDecoyCode);
    const offSetDecoy = requireCard(session, offSetDecoyCode);
    moveDuelCard(session.state, ignis.uid, "monsterZone", 0);
    ignis.faceUp = true;
    ignis.position = "faceUpAttack";
    ignis.summonType = "tribute";
    ignis.summonPlayer = 0;
    moveDuelCard(session.state, starter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return chainStarterScript();
        if (name === `c${searchTargetCode}.lua`) return activatableContinuousSpellScript("ignis target activated");
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [ignisCode, starterCode, searchTargetCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-4-1002",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 1, parameter: 1 }],
      },
    ]);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const ignisResponse = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === ignis.uid);
    expect(ignisResponse, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    expect(ignisResponse).toMatchObject({ player: 0, uid: ignis.uid, windowKind: "chainResponse" });
    applyLuaRestoreAndAssert(restoredResponse, ignisResponse!);
    expect(restoredResponse.session.state.chain).toEqual([]);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === ignis.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "tribute" });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ignis.uid,
      reasonEffectId: 2,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === offTypeDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredResponse.host.messages).not.toContain("ignis target activated");
    expect(restoredResponse.host.messages).toContain(`confirmed 1: ${searchTargetCode}`);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ignis.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: searchTarget.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [searchTarget.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ignis.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: searchTarget.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [searchTarget.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ignis.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredFinal = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredFinal);
    expectRestoredLegalActions(restoredFinal, restoredFinal.session.state.waitingFor ?? 1);
  });
});

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetCategory(CATEGORY_DRAW)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp) Debug.Message("ignis starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function activatableContinuousSpellScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
