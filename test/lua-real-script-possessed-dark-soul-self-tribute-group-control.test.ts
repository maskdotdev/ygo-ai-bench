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
const darkSoulCode = "52860176";
const legalA = "528601760";
const legalB = "528601761";
const highLevelDecoy = "528601762";
const facedownDecoy = "528601763";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDarkSoulScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darkSoulCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasDarkSoulScript)("Lua real script Possessed Dark Soul self-tribute group control", () => {
  it("restores SelfTribute cost into non-targeting Level 3-or-lower group control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${darkSoulCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 52860176, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkSoulCode] }, 1: { main: [legalA, legalB, highLevelDecoy, facedownDecoy] } });
    startDuel(session);

    const darkSoul = requireCard(session, darkSoulCode);
    const targetA = requireCard(session, legalA);
    const targetB = requireCard(session, legalB);
    const highLevel = requireCard(session, highLevelDecoy);
    const facedown = requireCard(session, facedownDecoy);
    moveFaceUpAttack(session, darkSoul, 0, 0);
    moveFaceUpAttack(session, targetA, 1, 0);
    moveFaceUpAttack(session, targetB, 1, 1);
    moveFaceUpAttack(session, highLevel, 1, 2);
    moveFaceDownDefense(session, facedown, 1, 3);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkSoulCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === darkSoul.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryControl, code: undefined, countLimit: undefined, event: "ignition", property: undefined, range: ["monsterZone"] },
    ]);

    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === darkSoul.uid
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);

    expect(restored.session.state.chain).toEqual([]);
    expect(findCard(restored.session, darkSoul.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: darkSoul.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, targetA.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: darkSoul.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, targetB.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: darkSoul.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, highLevel.uid)).toMatchObject({ location: "monsterZone", controller: 1, data: { level: 4 } });
    expect(findCard(restored.session, facedown.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: false });
    expect(restored.session.state.eventHistory.filter((event) => ["released", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
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
      { eventName: "released", eventCode: 1017, eventCardUid: darkSoul.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: darkSoul.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", previousController: 0, currentLocation: "graveyard", currentController: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: targetA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: darkSoul.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: targetB.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: darkSoul.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: targetA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: darkSoul.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
    ]);

    const restoredControl = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredControl);
    expectRestoredLegalActions(restoredControl, 0);
    expect(findCard(restoredControl.session, targetA.uid)).toMatchObject({ controller: 0, previousController: 1 });
    expect(findCard(restoredControl.session, targetB.uid)).toMatchObject({ controller: 0, previousController: 1 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: darkSoulCode, name: "Possessed Dark Soul", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 3, attack: 1200, defense: 800 },
    { code: legalA, name: "Possessed Dark Soul Legal A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 3, attack: 1000, defense: 1000 },
    { code: legalB, name: "Possessed Dark Soul Legal B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 2, attack: 900, defense: 900 },
    { code: highLevelDecoy, name: "Possessed Dark Soul High-Level Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
    { code: facedownDecoy, name: "Possessed Dark Soul Facedown Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 1, attack: 500, defense: 1500 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Possessed Dark Soul");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetCost(Cost.SelfTribute)");
  expect(script).toContain("return c:IsLevelBelow(3) and c:IsFaceup() and c:IsControlerCanBeChanged(true)");
  expect(script).toContain("Duel.GetMZoneCount(tp,e:GetHandler())>0");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.controlfilter,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,nil,1,1-tp,LOCATION_MZONE)");
  expect(script).toContain("Duel.GetMatchingGroup(s.controlfilter,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.GetControl(g,tp)");
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
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDownDefense";
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
