import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const rivalAppearsCode = "5728014";
const hasRivalAppearsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rivalAppearsCode}.lua`));
const opponentLevel4Code = "5728015";
const sameLevelHandCode = "5728016";
const wrongLevelHandCode = "5728017";
const responderCode = "5728018";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const raceWarrior = 0x1;
const raceSpellcaster = 0x2;
const attributeEarth = 0x1;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasRivalAppearsScript)("Lua real script A Rival Appears target level hand summon", () => {
  it("restores opponent target level into same-level hand Special Summon selection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${rivalAppearsCode}.lua`);
    expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,0,LOCATION_MZONE,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp,tc:GetLevel())");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: rivalAppearsCode, name: "A Rival Appears!", kind: "trap", typeFlags: typeTrap },
      { code: opponentLevel4Code, name: "Opponent Level 4 Witness", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
      { code: sameLevelHandCode, name: "Same-Level Hand Summon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1600, defense: 1200 },
      { code: wrongLevelHandCode, name: "Wrong-Level Hand Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 3, attack: 1500, defense: 1000 },
      { code: responderCode, name: "A Rival Appears Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5728014, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rivalAppearsCode, sameLevelHandCode, wrongLevelHandCode] }, 1: { main: [opponentLevel4Code, responderCode] } });
    startDuel(session);

    const rival = requireCard(session, rivalAppearsCode);
    const opponent = requireCard(session, opponentLevel4Code);
    const sameLevel = requireCard(session, sameLevelHandCode);
    const wrongLevel = requireCard(session, wrongLevelHandCode);
    const responder = requireCard(session, responderCode);
    const setRival = moveDuelCard(session.state, rival.uid, "spellTrapZone", 0);
    setRival.faceUp = false;
    setRival.position = "faceDown";
    const target = moveDuelCard(session.state, opponent.uid, "monsterZone", 1);
    target.faceUp = true;
    target.position = "faceUpAttack";
    moveDuelCard(session.state, sameLevel.uid, "hand", 0);
    moveDuelCard(session.state, wrongLevel.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rivalAppearsCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === rival.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toEqual([
      {
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1002",
        id: "chain-2",
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }],
        player: 0,
        sourceUid: rival.uid,
        targetFieldIds: [7],
        targetUids: [opponent.uid],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("rival appears responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === sameLevel.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: rival.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === wrongLevel.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === sameLevel.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: sameLevel.uid,
        eventUids: [sameLevel.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: rival.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("rival appears responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
