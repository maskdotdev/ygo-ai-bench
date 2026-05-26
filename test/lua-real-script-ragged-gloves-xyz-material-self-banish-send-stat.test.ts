import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, xyzSummonDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const raggedCode = "63821877";
const partnerCode = "638218770";
const xyzCode = "638218771";
const targetCode = "638218772";
const decoyCode = "638218773";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRaggedScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${raggedCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const attributeDark = 0x20;
const setPhantomKnights = 0xdb;
const setThePhantomKnights = 0x10db;
const effectAddType = 115;
const eventBeMaterial = 1108;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasRaggedScript)("Lua real script Ragged Gloves Xyz material self-banish send stat", () => {
  it("restores DARK Xyz material granted type and ATK trigger", () => {
    const { workspace, reader, session } = createRaggedSession(63821877);
    const ragged = requireCard(session, raggedCode);
    const partner = requireCard(session, partnerCode);
    const xyz = requireCard(session, xyzCode);
    moveFaceUpAttack(session, ragged, 0);
    moveFaceUpAttack(session, partner, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(raggedCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === ragged.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: eventBeMaterial, event: "continuous", id: "lua-1-1108", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: 0x20, code: undefined, event: "ignition", id: "lua-2", range: ["graveyard"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summoned = xyzSummonDuelCard(restoredOpen.session.state, 0, xyz.uid, [ragged.uid, partner.uid]);
    expect(summoned.uid).toBe(xyz.uid);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ragged.uid)).toMatchObject({
      location: "overlay",
      reason: duelReason.material | duelReason.xyz,
      reasonCardUid: xyz.uid,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["usedAsMaterial", "specialSummoned"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "overlay", eventCardUid: ragged.uid, eventCode: eventBeMaterial, eventName: "usedAsMaterial", eventReason: duelReason.xyz, eventReasonCardUid: xyz.uid, eventReasonPlayer: 0, previous: "monsterZone" },
      { current: "overlay", eventCardUid: partner.uid, eventCode: eventBeMaterial, eventName: "usedAsMaterial", eventReason: duelReason.xyz, eventReasonCardUid: xyz.uid, eventReasonPlayer: 0, previous: "monsterZone" },
      { current: "monsterZone", eventCardUid: xyz.uid, eventCode: eventSpecialSummonSuccess, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz, eventReasonCardUid: undefined, eventReasonPlayer: 0, previous: "extraDeck" },
    ]);
    expect(cardTypeFlags(xyz, restoredOpen.session.state) & typeEffect).toBe(typeEffect);
    expect(currentAttack(xyz, restoredOpen.session.state)).toBe(2000);

    expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === xyz.uid && effect.code === effectAddType)).toMatchObject({
      code: effectAddType,
      value: typeEffect,
    });
    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateTrigger" && action.uid === xyz.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    resolveRestoredChain(restoredOpen);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === xyz.uid), restoredOpen.session.state)).toBe(3000);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores grave self-banish cost into Phantom Knights Deck send", () => {
    const { workspace, reader, session } = createRaggedSession(63821878);
    const ragged = requireCard(session, raggedCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, ragged.uid, "graveyard", 0).faceUp = true;
    ragged.turnId = 1;
    session.state.turn = 3;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(raggedCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const send = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === ragged.uid && action.effectId === "lua-2");
    expect(send, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, send!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ragged.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: ragged.uid,
      reasonEffectId: 2,
    });
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ragged.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "banished", eventCardUid: ragged.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: ragged.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard" },
      { current: "graveyard", eventCardUid: target.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: ragged.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRaggedSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${raggedCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [raggedCode, partnerCode, targetCode, decoyCode], extra: [xyzCode] },
    1: { main: [] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("The Phantom Knights of Ragged Gloves");
  expect(script).toContain("e1:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("return r==REASON_XYZ and e:GetHandler():GetReasonCard():IsAttribute(ATTRIBUTE_DARK)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsXyzSummoned()");
  expect(script).toContain("c:UpdateAttack(1000)");
  expect(script).toContain("e2:SetCode(EFFECT_ADD_TYPE)");
  expect(script).toContain("e2:SetValue(TYPE_EFFECT)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return (c:IsSetCard(SET_THE_PHANTOM_KNIGHTS) or (c:IsSetCard(SET_PHANTOM_KNIGHTS) and c:IsSpellTrap())) and c:IsAbleToGrave()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: raggedCode, name: "The Phantom Knights of Ragged Gloves", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, level: 3, attack: 1000, defense: 500, setcodes: [setThePhantomKnights] },
    { code: partnerCode, name: "Ragged Gloves Xyz Material", kind: "monster", typeFlags: typeMonster, attribute: attributeDark, level: 3, attack: 900, defense: 900 },
    { code: xyzCode, name: "Ragged Gloves DARK Xyz", kind: "extra", typeFlags: typeMonster | typeXyz, attribute: attributeDark, level: 3, attack: 2000, defense: 1000, xyzMaterialCount: 2 },
    { code: targetCode, name: "Phantom Knights Send Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, level: 3, attack: 1200, defense: 800, setcodes: [setThePhantomKnights] },
    { code: decoyCode, name: "Phantom Knights Spell Decoy", kind: "spell", typeFlags: typeSpell, setcodes: [setPhantomKnights] },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", 0);
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  card.faceUp = true;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, response.state.waitingFor!));
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
