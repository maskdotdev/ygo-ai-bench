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
const aerosolCode = "88210105";
const graveCloudianCode = "882101050";
const deckCloudianCode = "882101051";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAerosolScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${aerosolCode}.lua`));
const setCloudian = 0x18;
const counterFog = 0x1019;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceAqua = 0x40;
const attributeWater = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasAerosolScript)("Lua real script Cloudian Aerosol grave banish summon", () => {
  it("restores grave cost banish into Deck Cloudian Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${aerosolCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 88210105, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [aerosolCode, graveCloudianCode, deckCloudianCode] }, 1: { main: [] } });
    startDuel(session);

    const aerosol = requireCard(session, aerosolCode);
    const graveCloudian = requireCard(session, graveCloudianCode);
    const deckCloudian = requireCard(session, deckCloudianCode);
    moveDuelCard(session.state, aerosol.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, graveCloudian.uid, "graveyard", 0).faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(aerosolCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === aerosol.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, aerosol.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: aerosol.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restored.session, graveCloudian.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: aerosol.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restored.session, deckCloudian.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: aerosol.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: graveCloudian.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: aerosol.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: aerosol.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: aerosol.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: graveCloudian.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: aerosol.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: deckCloudian.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: aerosol.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: aerosolCode, name: "Cloudian Aerosol", kind: "spell", typeFlags: typeSpell, setcodes: [setCloudian] },
    cloudianMonster(graveCloudianCode, "Cloudian Aerosol Grave Cloudian"),
    cloudianMonster(deckCloudianCode, "Cloudian Aerosol Deck Cloudian"),
  ];
}

function cloudianMonster(code: string, name: string): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, setcodes: [setCloudian], level: 4, attack: 1000, defense: 1000 };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.ctcfilter,tp,LOCATION_HAND,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(dc,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("Duel.IsExistingTarget(s.cttfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("tc:AddCounter(COUNTER_FOG,tc:GetLevel())");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_GRAVE,0,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("g:AddCard(e:GetHandler())");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_DECK,0,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
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
