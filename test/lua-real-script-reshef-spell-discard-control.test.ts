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
const reshefCode = "62420419";
const spellCostCode = "624204190";
const monsterDecoyCode = "624204191";
const opponentTargetCode = "624204192";
const opponentDecoyCode = "624204193";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasReshefScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${reshefCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeRitual = 0x80;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const effectReviveLimit = 31;
const effectFlagCannotDisable = 0x400;
const effectFlagUncopyable = 0x40000;
const effectFlagCardTarget = 0x10;
const reasonDiscardCost = duelReason.cost | duelReason.discard;

describe.skipIf(!hasUpstreamScripts || !hasReshefScript)("Lua real script Reshef spell discard control", () => {
  it("restores spell-only discard cost into targeted temporary control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${reshefCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredReshefField({ reader, workspace });
    const reshef = requireCard(restoredOpen.session, reshefCode);
    const spellCost = requireCard(restoredOpen.session, spellCostCode);
    const monsterDecoy = requireCard(restoredOpen.session, monsterDecoyCode);
    const target = requireCard(restoredOpen.session, opponentTargetCode);
    const opponentDecoy = requireCard(restoredOpen.session, opponentDecoyCode);

    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === reshef.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: effectReviveLimit, countLimit: undefined, event: "continuous", property: effectFlagCannotDisable | effectFlagUncopyable, range: ["monsterZone"] },
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"] },
    ]);

    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === reshef.uid
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);

    expect(findCard(restoredOpen.session, spellCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: reasonDiscardCost,
      reasonPlayer: 0,
      reasonCardUid: reshef.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restoredOpen.session, monsterDecoy.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(findCard(restoredOpen.session, target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: reshef.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restoredOpen.session, opponentDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["discarded", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "discarded", eventCardUid: spellCost.uid, eventReason: reasonDiscardCost, eventReasonPlayer: 0, eventReasonCardUid: reshef.uid, eventReasonEffectId: 2, previous: "hand", current: "graveyard", previousController: 0, currentController: 0 },
      { eventName: "becameTarget", eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone", previousController: 1, currentController: 1 },
      { eventName: "controlChanged", eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: reshef.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "monsterZone", previousController: 1, currentController: 0 },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(findCard(restoredResolved.session, target.uid)).toMatchObject({ controller: 0, previousController: 1 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: reshefCode, name: "Reshef the Dark Being", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceFiend, attribute: attributeDark, level: 8, attack: 2500, defense: 1500 },
    { code: spellCostCode, name: "Reshef Spell Cost", kind: "spell", typeFlags: typeSpell },
    { code: monsterDecoyCode, name: "Reshef Monster Cost Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTargetCode, name: "Reshef Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
    { code: opponentDecoyCode, name: "Reshef Opponent Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function createRestoredReshefField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 62420419, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [reshefCode, spellCostCode, monsterDecoyCode] },
    1: { main: [opponentTargetCode, opponentDecoyCode] },
  });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, reshefCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, spellCostCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, monsterDecoyCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentDecoyCode), 1, 1);
  session.state.turn = 2;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(reshefCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Reshef the Dark Being");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsDiscardable() and c:IsSpell()");
  expect(script).toContain("Duel.DiscardHand(tp,s.cfilter,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
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
