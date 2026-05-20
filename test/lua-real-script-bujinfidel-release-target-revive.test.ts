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
const bujinfidelCode = "66727115";
const hasBujinfidelScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bujinfidelCode}.lua`));
const releaseCode = "66727116";
const reviveCode = "66727117";
const sameCodeDecoyCode = "66727116";
const offSetDecoyCode = "66727118";
const responderCode = "66727119";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceBeastWarrior = 0x8000;
const raceWarrior = 0x1;
const setBujin = 0x88;

describe.skipIf(!hasUpstreamScripts || !hasBujinfidelScript)("Lua real script Bujinfidel release target revive", () => {
  it("restores release-cost code label into targeted differently named Bujin graveyard Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${bujinfidelCode}.lua`);
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.rfilter,1,false,nil,nil,e,tp,ft)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.rfilter,1,1,false,nil,nil,e,tp,ft)");
    expect(script).toContain("local code=g:GetFirst():GetCode()");
    expect(script).toContain("e:SetLabel(code)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,code,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,sg,1,0,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: bujinfidelCode, name: "Bujinfidel", kind: "spell", typeFlags: typeSpell },
      { code: releaseCode, name: "Bujin Release Beast-Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, level: 4, attack: 1700, defense: 1000, setcodes: [setBujin] },
      { code: reviveCode, name: "Bujin Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, level: 4, attack: 1600, defense: 1200, setcodes: [setBujin] },
      { code: sameCodeDecoyCode, name: "Bujin Same-Code Grave Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, level: 4, attack: 1500, defense: 1000, setcodes: [setBujin] },
      { code: offSetDecoyCode, name: "Off-Set Grave Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Bujinfidel Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 66727115, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bujinfidelCode, releaseCode, reviveCode, sameCodeDecoyCode, offSetDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const bujinfidel = requireNthCard(session, bujinfidelCode, 0);
    const release = requireNthCard(session, releaseCode, 0);
    const revive = requireNthCard(session, reviveCode, 0);
    const sameCodeDecoy = requireNthCard(session, sameCodeDecoyCode, 1);
    const offSetDecoy = requireNthCard(session, offSetDecoyCode, 0);
    const responder = requireNthCard(session, responderCode, 0);
    moveDuelCard(session.state, bujinfidel.uid, "hand", 0);
    const releasedField = moveDuelCard(session.state, release.uid, "monsterZone", 0);
    releasedField.position = "faceUpAttack";
    releasedField.faceUp = true;
    moveDuelCard(session.state, revive.uid, "graveyard", 0);
    moveDuelCard(session.state, sameCodeDecoy.uid, "graveyard", 0);
    moveDuelCard(session.state, offSetDecoy.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(bujinfidelCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === bujinfidel.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonCardUid: bujinfidel.uid,
      reasonEffectId: 1,
    });
    expect(session.state.chain).toEqual([
      {
        activationLocation: "hand",
        activationSequence: 0,
        chainIndex: 1,
        effectLabel: Number(releaseCode),
        effectId: "lua-1-1002",
        id: "chain-3",
        operationInfos: [{ category: 0x200, targetUids: [revive.uid], count: 1, player: 0, parameter: 0 }],
        player: 0,
        sourceUid: bujinfidel.uid,
        targetUids: [revive.uid],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("bujinfidel responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === revive.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: bujinfidel.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === sameCodeDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === release.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: bujinfidel.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 3 },
        eventCardUid: release.uid,
      },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === revive.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: revive.uid,
        eventUids: [revive.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: bujinfidel.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
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
      e:SetOperation(function(e,tp) Debug.Message("bujinfidel responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireNthCard(session: DuelSession, code: string, index: number) {
  const card = session.state.cards.filter((candidate) => candidate.code === code)[index];
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
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
