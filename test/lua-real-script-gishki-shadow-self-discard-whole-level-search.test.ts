import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const gishkiShadowCode = "29888389";
const ritualSpellCode = "29888390";
const waterRitualCode = "29888391";
const fireRitualCode = "29888392";
const offSetSpellCode = "29888393";
const responderCode = "29888394";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeRitual = 0x80;
const attributeWater = 0x2;
const attributeFire = 0x4;
const setGishki = 0x3a;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gishki Shadow self-discard whole-level search", () => {
  it("restores self-discard Ritual Spell search and WATER ritual whole-level tribute value", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${gishkiShadowCode}.lua`);
    expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
    expect(script).toContain("return c:IsSetCard(SET_GISHKI) and c:IsRitualSpell() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Ritual.AddWholeLevelTribute(c,aux.FilterBoolFunction(Card.IsAttribute,ATTRIBUTE_WATER))");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gishkiShadowCode),
      { code: ritualSpellCode, name: "Gishki Shadow Ritual Spell Search", kind: "spell", typeFlags: typeSpell | typeRitual, setcodes: [setGishki] },
      { code: waterRitualCode, name: "Gishki Shadow WATER Ritual Probe", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, setcodes: [setGishki], attribute: attributeWater, level: 6, attack: 2000, defense: 1800 },
      { code: fireRitualCode, name: "Gishki Shadow FIRE Ritual Probe", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, setcodes: [setGishki], attribute: attributeFire, level: 6, attack: 2000, defense: 1800 },
      { code: offSetSpellCode, name: "Gishki Shadow Off-Set Spell Decoy", kind: "spell", typeFlags: typeSpell | typeRitual, setcodes: [0x1] },
      { code: responderCode, name: "Gishki Shadow Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 29888389, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gishkiShadowCode, ritualSpellCode, waterRitualCode, fireRitualCode, offSetSpellCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const shadow = requireCard(session, gishkiShadowCode);
    const ritualSpell = requireCard(session, ritualSpellCode);
    const waterRitual = requireCard(session, waterRitualCode);
    const fireRitual = requireCard(session, fireRitualCode);
    const offSetSpell = requireCard(session, offSetSpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, shadow.uid, "hand", 0);
    moveDuelCard(session.state, waterRitual.uid, "hand", 0);
    moveDuelCard(session.state, fireRitual.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const text = workspace.readScript(name);
        if (text === undefined) throw new Error(`Missing script ${name}`);
        return text;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gishkiShadowCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expectRitualLevelProbe(restoredOpen, "gishki shadow ritual levels 262150/4");
    const ritualLevelEffect = restoredOpen.session.state.effects.find((effect) => effect.sourceUid === shadow.uid && effect.code === 241);
    expect(ritualLevelEffect).toMatchObject({
      event: "continuous",
      code: 241,
      registryKey: "lua:29888389:lua-2-241",
      sourceUid: shadow.uid,
    });

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === shadow.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === shadow.uid)).toMatchObject({ location: "graveyard", controller: 0 });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("gishki shadow responder resolved");
    expect(restoredChain.host.messages).toContain(`confirmed 1: ${ritualSpellCode}`);
    expect(restoredChain.session.state.cards.find((card) => card.uid === ritualSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: shadow.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offSetSpell.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      sentToGraveEvent(shadow.uid),
      sentToHandEvent(ritualSpell.uid, shadow.uid),
      confirmedEvent(ritualSpell.uid, shadow.uid),
      sentToHandConfirmedEvent(ritualSpell.uid, shadow.uid),
    ]);
  });
});

function expectRitualLevelProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local shadow=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${gishkiShadowCode}),0,LOCATION_HAND,0,nil)
      local water=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${waterRitualCode}),0,LOCATION_HAND,0,nil)
      local fire=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fireRitualCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("gishki shadow ritual levels " .. shadow:GetRitualLevel(water) .. "/" .. shadow:GetRitualLevel(fire))
    `,
    "gishki-shadow-ritual-level-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}

function sentToGraveEvent(cardUid: string) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: cardUid,
    eventReason: duelReason.cost | duelReason.discard,
    eventReasonPlayer: 0,
    eventReasonCardUid: cardUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
  };
}

function sentToHandEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 2 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 2 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 2 },
  };
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
      e:SetOperation(function(e,tp) Debug.Message("gishki shadow responder resolved") end)
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
