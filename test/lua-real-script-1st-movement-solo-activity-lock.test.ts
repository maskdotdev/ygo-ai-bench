import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const soloCode = "44256816";
const hasSoloScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${soloCode}.lua`));
const melodiousDeckCode = "44256817";
const melodiousHandCode = "44256818";
const offSetHandCode = "44256819";
const responderCode = "44256820";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const setMelodious = 0x9b;
const categorySpecialSummon = 0x200;
const locationHandDeck = 0x3;
const effectCannotSpecialSummon = 22;
const duelActivitySpecialSummon = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasSoloScript)("Lua real script 1st Movement Solo activity lock", () => {
  it("restores custom Special Summon activity cost, Melodious-only oath lock, and hand summon filtering", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${soloCode}.lua`);
    expect(script).toContain("Duel.AddCustomActivityCounter(id,ACTIVITY_SPSUMMON,s.counterfilter)");
    expect(script).toContain("Duel.GetCustomActivityCount(id,tp,ACTIVITY_SPSUMMON)==0");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_OATH)");
    expect(script).toContain("e1:SetLabelObject(e)");
    expect(script).toContain("return not c:IsSetCard(SET_MELODIOUS)");
    expect(script).toContain("aux.RegisterClientHint(e:GetHandler(),nil,tp,1,0,aux.Stringid(id,1),nil)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK|LOCATION_HAND,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: soloCode, name: "1st Movement Solo", kind: "spell", typeFlags: typeSpell },
      { code: melodiousDeckCode, name: "Solo Deck Melodious", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, level: 4, attack: 1600, defense: 1200, setcodes: [setMelodious] },
      { code: melodiousHandCode, name: "Solo Hand Melodious Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, level: 5, attack: 1000, defense: 1000, setcodes: [setMelodious] },
      { code: offSetHandCode, name: "Solo Off-Set Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 5, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Solo Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 44256816, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [soloCode, melodiousDeckCode, melodiousHandCode, offSetHandCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const solo = requireCard(session, soloCode);
    const melodiousDeck = requireCard(session, melodiousDeckCode);
    const melodiousHand = requireCard(session, melodiousHandCode);
    const offSetHand = requireCard(session, offSetHandCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, solo.uid, "hand", 0);
    moveDuelCard(session.state, melodiousHand.uid, "hand", 0);
    moveDuelCard(session.state, offSetHand.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${melodiousHandCode}.lua`) return handSummonProbeScript("melodious hand probe");
        if (name === `c${offSetHandCode}.lua`) return handSummonProbeScript("off-set hand probe");
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(soloCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(melodiousHandCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(offSetHandCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    expect(session.state.activityHistory.filter((record) => record.player === 0 && record.activity === duelActivitySpecialSummon)).toEqual([]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === solo.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        activationLocation: "hand",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1002",
        id: "chain-2",
        operationInfos: [{ category: categorySpecialSummon, count: 1, player: 0, parameter: locationHandDeck, targetUids: [] }],
        player: 0,
        sourceUid: solo.uid,
      },
    ]);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === solo.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === melodiousDeck.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: solo.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.activityHistory.filter((record) => record.player === 0 && record.activity === duelActivitySpecialSummon)).toEqual([
      { player: 0, activity: duelActivitySpecialSummon, cardUid: melodiousDeck.uid },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectCannotSpecialSummon)).toEqual([
      expect.objectContaining({
        code: effectCannotSpecialSummon,
        event: "continuous",
        luaTargetDescriptor: `target:not-setcode:${setMelodious}`,
        sourceUid: solo.uid,
      }),
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === melodiousDeck.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: melodiousDeck.uid,
        eventUids: [melodiousDeck.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: solo.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredLocked = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredLocked);
    expectRestoredLegalActions(restoredLocked, 0);
    const lockedActions = getLuaRestoreLegalActions(restoredLocked, 0);
    const offSetProbe = lockedActions.find((action) => action.type === "activateEffect" && action.uid === offSetHand.uid);
    expect(offSetProbe, JSON.stringify(lockedActions, null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredLocked, offSetProbe!);
    passRestoredChain(restoredLocked);
    expect(restoredLocked.session.state.cards.find((card) => card.uid === offSetHand.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredLocked.host.messages).not.toContain("off-set hand probe resolved");

    const restoredAfterBlockedProbe = restoreDuelWithLuaScripts(serializeDuel(restoredLocked.session), source, reader);
    expectCleanRestore(restoredAfterBlockedProbe);
    expectRestoredLegalActions(restoredAfterBlockedProbe, 0);
    const afterBlockedActions = getLuaRestoreLegalActions(restoredAfterBlockedProbe, 0);
    const melodiousProbe = afterBlockedActions.find((action) => action.type === "activateEffect" && action.uid === melodiousHand.uid);
    expect(melodiousProbe, JSON.stringify(afterBlockedActions, null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredAfterBlockedProbe, melodiousProbe!);
    passRestoredChain(restoredAfterBlockedProbe);
    expect(restoredAfterBlockedProbe.session.state.cards.find((card) => card.uid === melodiousHand.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.summon | duelReason.specialSummon,
    });
    expect(restoredAfterBlockedProbe.host.messages).toContain("melodious hand probe resolved");
    expect(restoredAfterBlockedProbe.host.messages).not.toContain("solo responder resolved");
  });
});

function handSummonProbeScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        if Duel.SpecialSummon(e:GetHandler(),0,tp,tp,false,false,POS_FACEUP)>0 then
          Debug.Message("${message} resolved")
        end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("solo responder resolved") end)
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
