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
const revolutionForceCode = "43476205";
const raidraptorXyzCode = "434762050";
const rankUpXyzCode = "434762051";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRevolutionForceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${revolutionForceCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeQuickPlay = 0x10000;
const typeXyz = 0x800000;
const raceWingedBeast = 0x200;
const attributeDark = 0x20;
const setRaidraptor = 0xba;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasRevolutionForceScript)("Lua real script RUM Revolution Force rank-up overlay", () => {
  it("restores self-turn Raidraptor Xyz rank-up into overlay material and Xyz Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 43476205, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [revolutionForceCode], extra: [raidraptorXyzCode, rankUpXyzCode] },
      1: { main: [] },
    });
    startDuel(session);
    expectScriptShape(workspace.readScript(`official/c${revolutionForceCode}.lua`));

    const revolutionForce = requireCard(session, revolutionForceCode);
    const raidraptorXyz = requireCard(session, raidraptorXyzCode);
    const rankUpXyz = requireCard(session, rankUpXyzCode);
    const setSpell = moveDuelCard(session.state, revolutionForce.uid, "spellTrapZone", 0);
    setSpell.faceUp = false;
    setSpell.position = "faceDown";
    setSpell.turnId = 0;
    moveFaceUpAttack(session, raidraptorXyz, 0);
    prepareMainPhase(session);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(revolutionForceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === revolutionForce.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: 0x200, code: eventFreeChain, event: "quick", id: `lua-1-${eventFreeChain}`, property: 0x10, range: ["hand", "spellTrapZone"] },
    ]);

    const rankUp = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === revolutionForce.uid && action.effectId === `lua-1-${eventFreeChain}`);
    expect(rankUp, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, rankUp!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === revolutionForce.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === raidraptorXyz.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: revolutionForce.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === rankUpXyz.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "xyz",
      summonMaterialUids: [raidraptorXyz.uid],
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: revolutionForce.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === rankUpXyz.uid)?.overlayUids).toEqual([raidraptorXyz.uid]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "xyzMaterialAttached", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual(expect.arrayContaining([
      { eventName: "becameTarget", eventCardUid: raidraptorXyz.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "specialSummoned", eventCardUid: rankUpXyz.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: revolutionForce.uid, eventReasonEffectId: 1, previous: "extraDeck", current: "monsterZone" },
    ]));
  });
});

function cards(): DuelCardData[] {
  return [
    { code: revolutionForceCode, name: "Rank-Up-Magic Revolution Force", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    { code: raidraptorXyzCode, name: "RUM Revolution Force Raidraptor Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWingedBeast, attribute: attributeDark, level: 4, attack: 2000, defense: 1000, setcodes: [setRaidraptor] },
    { code: rankUpXyzCode, name: "RUM Revolution Force Rank-Up Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWingedBeast, attribute: attributeDark, level: 5, attack: 2500, defense: 1600, setcodes: [setRaidraptor] },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Rank-Up-Magic Revolution Force");
  expect(script).toContain("aux.GetMustBeMaterialGroup(tp,Group.FromCards(c),tp,nil,nil,REASON_XYZ)");
  expect(script).toContain("Duel.GetLocationCountFromEx(tp,tp,mc,c)>0");
  expect(script).toContain("Duel.IsTurnPlayer(tp)");
  expect(script).toContain("Duel.IsTurnPlayer(1-tp)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("sc:SetMaterial(tc)");
  expect(script).toContain("Duel.Overlay(sc,tc)");
  expect(script).toContain("Duel.SpecialSummon(sc,SUMMON_TYPE_XYZ,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("sc:CompleteProcedure()");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
