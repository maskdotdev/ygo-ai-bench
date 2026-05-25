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
const enlilgirsuCode = "74820316";
const banishedOrcustCode = "748203160";
const controlTargetCode = "748203161";
const otherTargetCode = "748203162";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasEnlilgirsuScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${enlilgirsuCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceMachine = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setOrcust = 0x11b;
const categoryToDeck = 0x10;
const categoryToGrave = 0x20;
const categoryToHand = 0x8;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasEnlilgirsuScript)("Lua real script Enlilgirsu banished return deck control", () => {
  it("restores targeted banished return into optional hand-to-Deck control branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${enlilgirsuCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 74820316, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [enlilgirsuCode, banishedOrcustCode] }, 1: { main: [controlTargetCode, otherTargetCode] } });
    startDuel(session);

    const enlilgirsu = requireCard(session, enlilgirsuCode);
    const banishedOrcust = requireCard(session, banishedOrcustCode);
    const controlTarget = requireCard(session, controlTargetCode);
    const otherTarget = requireCard(session, otherTargetCode);
    moveFaceUpAttack(session, enlilgirsu, 0, 0);
    const banished = moveDuelCard(session.state, banishedOrcust.uid, "banished", 0);
    banished.faceUp = true;
    moveFaceUpAttack(session, controlTarget, 1, 0);
    moveFaceUpAttack(session, otherTarget, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expect(host.loadCardScript(Number(enlilgirsuCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === enlilgirsu.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", property: 263168, range: ["monsterZone"] },
      { category: categoryToHand | categoryToDeck | categoryControl, code: undefined, countLimit: 1, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"] },
      { category: categoryToHand | categoryToDeck | categoryControl, code: eventFreeChain, countLimit: 1, event: "quick", property: effectFlagCardTarget, range: ["monsterZone"] },
      { category: categoryToGrave, code: undefined, countLimit: 1, event: "ignition", property: undefined, range: ["graveyard"] },
      { category: categoryToGrave, code: eventFreeChain, countLimit: 1, event: "quick", property: undefined, range: ["graveyard"] },
    ]);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === enlilgirsu.uid && candidate.effectId === "lua-2"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1197125058, returned: true },
    ]);
    expect(findCard(restored.session, banishedOrcust.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: enlilgirsu.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restored.session, controlTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: enlilgirsu.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restored.session, otherTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.eventHistory.filter((event) => ["sentToHand", "sentToDeck", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "sentToHand", eventCardUid: banishedOrcust.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: enlilgirsu.uid, eventReasonEffectId: 2, previousLocation: "banished", previousController: 0, currentLocation: "hand", currentController: 0 },
      { eventName: "sentToDeck", eventCardUid: banishedOrcust.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: enlilgirsu.uid, eventReasonEffectId: 2, previousLocation: "hand", previousController: 0, currentLocation: "deck", currentController: 0 },
      { eventName: "controlChanged", eventCardUid: controlTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: enlilgirsu.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Enlilgirsu, the Orcust Mekk-Knight");
  expect(script).toContain("e1a:SetCategory(CATEGORY_TOHAND+CATEGORY_TODECK+CATEGORY_CONTROL)");
  expect(script).toContain("e1a:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1a:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1b:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("return c:IsSetCard{SET_ORCUST,SET_WORLD_LEGACY} and c:IsAbleToHand() and c:IsFaceup()");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_REMOVED,0,1,1,nil)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("Duel.GetControl(sc,tp)");
  expect(script).toContain("c:IsPreviousLocation(LOCATION_EMZONE) and c:GetTurnID()==Duel.GetTurnCount()");
}

function cards(): DuelCardData[] {
  return [
    { code: enlilgirsuCode, name: "Enlilgirsu, the Orcust Mekk-Knight", kind: "monster", typeFlags: typeMonster | typeEffect | typeLink, race: raceMachine, attribute: attributeDark, setcodes: [setOrcust], level: 8, attack: 2600, defense: 0 },
    { code: banishedOrcustCode, name: "Enlilgirsu Banished Orcust", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, setcodes: [setOrcust], level: 4, attack: 1400, defense: 1000 },
    { code: controlTargetCode, name: "Enlilgirsu Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    { code: otherTargetCode, name: "Enlilgirsu Other Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1200 },
  ];
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.position = "faceUpAttack";
  moved.faceUp = true;
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  if (restored.session.state.chain.length === 0) return;
  const pass = getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? 0).find((candidate) => candidate.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
