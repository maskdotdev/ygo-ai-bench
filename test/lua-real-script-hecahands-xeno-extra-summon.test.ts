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
const xenoCode = "94410955";
const opponentExtraACode = "944109550";
const opponentExtraBCode = "944109551";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasXenoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${xenoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceIllusion = 0x2000000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setHecahands = 0x1a9;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasXenoScript)("Lua real script Hecahands Xeno extra summon", () => {
  it("restores opponent Extra Deck confirmation into optional Special Summon and shuffle", () => {
    const { workspace, reader, session } = createFixture(94410955);
    expectScriptShape(workspace.readScript(`official/c${xenoCode}.lua`));
    const xeno = requireCard(session, xenoCode);
    const extraA = requireCard(session, opponentExtraACode);
    const extraB = requireCard(session, opponentExtraBCode);
    moveFaceUpAttack(session, xeno, 0);
    prepareMainPhase(session);
    registerXeno(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === xeno.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", id: "lua-1-31", range: ["monsterZone"] },
      { category: undefined, code: 42, countLimit: undefined, event: "continuous", id: "lua-2-42", range: ["monsterZone"] },
      { category: 0x200, code: eventFreeChain, countLimit: 1, event: "quick", id: `lua-3-${eventFreeChain}`, range: ["monsterZone"] },
      { category: 0x2000, code: 1029, countLimit: 1, event: "trigger", id: "lua-4-1029", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
    ]);

    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === xeno.uid && action.effectId === `lua-3-${eventFreeChain}`);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    resolveRestoredChain(restoredOpen);

    const summoned = [extraA, extraB].map((card) => restoredOpen.session.state.cards.find((candidate) => candidate.uid === card.uid)!).find((card) => card.location === "monsterZone" && card.controller === 0);
    expect(summoned).toBeDefined();
    expect(summoned).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: xeno.uid,
      reasonEffectId: 3,
    });
    const remaining = [extraA, extraB].map((card) => restoredOpen.session.state.cards.find((candidate) => candidate.uid === card.uid)!).filter((card) => card.uid !== summoned!.uid);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ location: "extraDeck", controller: 1, faceUp: false });
    expect(restoredOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1510575282, returned: true },
    ]);
    expect(restoredOpen.host.messages.some((message) => message.includes(opponentExtraACode))).toBe(true);
    expect(restoredOpen.host.messages.some((message) => message.includes(opponentExtraBCode))).toBe(true);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["confirmed", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toContainEqual({
      eventName: "specialSummoned",
      eventCardUid: summoned!.uid,
      eventReason: duelReason.summon | duelReason.specialSummon,
      eventReasonCardUid: xeno.uid,
      eventReasonEffectId: 3,
      previous: "extraDeck",
      current: "monsterZone",
    });
  });
});

function createFixture(seed: number): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [xenoCode] }, 1: { main: [], extra: [opponentExtraACode, opponentExtraBCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: xenoCode, name: "Hecahands Xeno", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceIllusion, attribute: attributeDark, setcodes: [setHecahands], level: 10, attack: 3000, defense: 3000, fusionMaterialMin: 3, fusionMaterialMax: 3, fusionMaterialSetcode: setHecahands },
    { code: opponentExtraACode, name: "Hecahands Xeno Opponent Extra A", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeEarth, level: 6, attack: 2100, defense: 1600 },
    { code: opponentExtraBCode, name: "Hecahands Xeno Opponent Extra B", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeDark, level: 6, attack: 2200, defense: 1500 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Hecahands Xeno");
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_HECAHANDS),3)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_EXTRA)");
  expect(script).toContain("Duel.GetLocationCountFromEx(tp,tp,nil,c)>0");
  expect(script).toContain("Duel.ConfirmCards(tp,g)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.ShuffleExtra(1-tp)");
  expect(script).toContain("Duel.GetControl(g,tp)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerXeno(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(xenoCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
