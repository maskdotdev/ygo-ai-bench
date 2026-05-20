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
const limitedBariansForceCode = "92365601";
const hasLimitedBariansForceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${limitedBariansForceCode}.lua`));
const rank4Code = "92365602";
const rank5Code = "92365603";
const offSetRank5Code = "92365604";
const priorMaterialCode = "92365605";
const responderCode = "92365606";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeXyz = 0x800000;
const setNumberC = 0x1048;
const setOff = 0x123;
const raceWarrior = 0x1;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasLimitedBariansForceScript)("Lua real script Limited Barian's Force rank-up overlay", () => {
  it("restores targeted Rank-Up-Magic Xyz summon with target and existing materials overlaid", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${limitedBariansForceCode}.lua`);
    expect(script).toContain("aux.GetMustBeMaterialGroup(tp,Group.FromCards(c),tp,nil,nil,REASON_XYZ)");
    expect(script).toContain("Duel.GetLocationCountFromEx(tp,tp,mc,c)>0");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter1,tp,LOCATION_MZONE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter2,tp,LOCATION_EXTRA,0,1,1,nil,e,tp,tc,tc:GetRank()+1,pg)");
    expect(script).toContain("sc:SetMaterial(tc)");
    expect(script).toContain("Duel.Overlay(sc,tc)");
    expect(script).toContain("Duel.SpecialSummon(sc,SUMMON_TYPE_XYZ,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("sc:CompleteProcedure()");

    const cards: DuelCardData[] = [
      { code: limitedBariansForceCode, name: "Rank-Up-Magic Limited Barian's Force", kind: "spell", typeFlags: typeSpell },
      { code: rank4Code, name: "Rank 4 Xyz Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2000, defense: 1000 },
      { code: rank5Code, name: "Number C Rank 5 Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeLight, level: 5, attack: 2600, defense: 1800, setcodes: [setNumberC] },
      { code: offSetRank5Code, name: "Off-Set Rank 5 Xyz Decoy", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeLight, level: 5, attack: 2500, defense: 1700, setcodes: [setOff] },
      { code: priorMaterialCode, name: "Prior Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Limited Barian's Force Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 92365601, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [limitedBariansForceCode, priorMaterialCode], extra: [rank4Code, rank5Code, offSetRank5Code] }, 1: { main: [responderCode] } });
    startDuel(session);

    const rum = requireCard(session, limitedBariansForceCode);
    const rank4 = requireCard(session, rank4Code);
    const rank5 = requireCard(session, rank5Code);
    const offSetRank5 = requireCard(session, offSetRank5Code);
    const priorMaterial = requireCard(session, priorMaterialCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, rum.uid, "hand", 0);
    const fieldRank4 = moveDuelCard(session.state, rank4.uid, "monsterZone", 0);
    fieldRank4.faceUp = true;
    fieldRank4.position = "faceUpAttack";
    moveDuelCard(session.state, priorMaterial.uid, "overlay", 0, duelReason.material | duelReason.xyz);
    rank4.overlayUids.push(priorMaterial.uid);
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
    expect(host.loadCardScript(Number(limitedBariansForceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === rum.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toEqual([
      {
        activationLocation: "hand",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1002",
        id: "chain-2",
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }],
        player: 0,
        sourceUid: rum.uid,
        targetUids: [rank4.uid],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("limited barians force responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === rum.uid)).toMatchObject({ location: "graveyard", reason: duelReason.rule });
    expect(restoredChain.session.state.cards.find((card) => card.uid === rank5.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "xyz",
      overlayUids: [rank4.uid, priorMaterial.uid],
      summonMaterialUids: [rank4.uid],
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: rum.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === rank4.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: rum.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === priorMaterial.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: rum.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offSetRank5.uid)).toMatchObject({ location: "extraDeck" });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === rank5.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: rank5.uid,
        eventUids: [rank5.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: rum.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 1 },
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
      e:SetOperation(function(e,tp) Debug.Message("limited barians force responder resolved") end)
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
