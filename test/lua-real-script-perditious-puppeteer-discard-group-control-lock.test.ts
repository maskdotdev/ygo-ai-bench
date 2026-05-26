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
const puppeteerCode = "71564150";
const discardCode = "715641500";
const ownBlockerCode = "715641501";
const opponentTargetCode = "715641502";
const opponentTooHighCode = "715641503";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPuppeteerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${puppeteerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const effectFlagClientHint = 0x4000000;
const effectUnreleasableSum = 43;
const effectUnreleasableNonsum = 44;
const effectCannotTrigger = 7;
const effectCannotBeSynchroMaterial = 236;

describe.skipIf(!hasUpstreamScripts || !hasPuppeteerScript)("Lua real script Perditious Puppeteer discard group control lock", () => {
  it("restores discard-cost group control and operated-group release/trigger/synchro locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${puppeteerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredPuppeteerField({ reader, workspace });
    const puppeteer = requireCard(restoredOpen.session, puppeteerCode);
    const discard = requireCard(restoredOpen.session, discardCode);
    const target = requireCard(restoredOpen.session, opponentTargetCode);
    const tooHigh = requireCard(restoredOpen.session, opponentTooHighCode);

    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === puppeteer.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", property: undefined, range: ["monsterZone"] },
    ]);

    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === puppeteer.uid
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discard.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: puppeteer.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);

    expect(findCard(restoredResolved.session, target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: puppeteer.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredResolved.session, tooHigh.uid)).toMatchObject({ controller: 1, location: "monsterZone" });
    expect(restoredResolved.session.state.effects.filter((effect) =>
      effect.sourceUid === target.uid
      && [effectUnreleasableSum, effectUnreleasableNonsum, effectCannotTrigger, effectCannotBeSynchroMaterial].includes(effect.code ?? 0)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      value: effect.value,
    }))).toEqual([
      { code: effectUnreleasableSum, event: "continuous", property: effectFlagClientHint, value: 1 },
      { code: effectUnreleasableNonsum, event: "continuous", property: effectFlagClientHint, value: 1 },
      { code: effectCannotTrigger, event: "continuous", property: effectFlagClientHint, value: 1 },
      { code: effectCannotBeSynchroMaterial, event: "continuous", property: effectFlagClientHint, value: 1 },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: puppeteer.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 4 },
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: puppeteerCode, name: "Perditious Puppeteer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 7, attack: 2700, defense: 500 },
    { code: discardCode, name: "Puppeteer Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: ownBlockerCode, name: "Puppeteer Own Zone Blocker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTargetCode, name: "Puppeteer Level 3 Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 3, attack: 1200, defense: 800 },
    { code: opponentTooHighCode, name: "Puppeteer Level 4 Non Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Perditious Puppeteer");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetCost(s.cost)");
  expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("return c:IsFaceup() and c:IsLevelBelow(3) and c:IsControlerCanBeChanged()");
  expect(script).toContain("Duel.GetControl(g,tp,PHASE_END,1)");
  expect(script).toContain("local og=Duel.GetOperatedGroup()");
  expect(script).toContain("e1:SetCode(EFFECT_UNRELEASABLE_SUM)");
  expect(script).toContain("e2:SetCode(EFFECT_UNRELEASABLE_NONSUM)");
  expect(script).toContain("e3:SetCode(EFFECT_CANNOT_TRIGGER)");
  expect(script).toContain("e4:SetCode(EFFECT_CANNOT_BE_SYNCHRO_MATERIAL)");
}

function createRestoredPuppeteerField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 71564150, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [puppeteerCode, discardCode, ownBlockerCode, ownBlockerCode, ownBlockerCode] },
    1: { main: [opponentTargetCode, opponentTooHighCode] },
  });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, puppeteerCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, discardCode).uid, "hand", 0);
  session.state.cards.filter((card) => card.code === ownBlockerCode).forEach((card, index) => moveFaceUpAttack(session, card, 0, index + 1));
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentTooHighCode), 1, 1);
  session.state.turn = 2;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(puppeteerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
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
