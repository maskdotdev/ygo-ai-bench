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
const illegalKnightCode = "42198835";
const adventurerTokenCode = "3285552";
const opponentMonsterCode = "421988350";
const opponentSpellCode = "421988351";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasIllegalKnightScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${illegalKnightCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeToken = 0x4000;
const raceFiend = 0x8;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const eventFreeChain = 1002;

describe.skipIf(!hasUpstreamScripts || !hasIllegalKnightScript)("Lua real script Illegal Knight quick summon control to-hand", () => {
  it("restores hand Quick Effect self Special Summon while the player's monster zone is empty", () => {
    const { workspace, reader, session } = createFixture(42198835);
    expectScriptShape(workspace.readScript(`official/c${illegalKnightCode}.lua`) ?? "");
    const illegalKnight = requireCard(session, illegalKnightCode);
    moveDuelCard(session.state, illegalKnight.uid, "hand", 0);
    prepareMainPhase(session);
    registerIllegalKnight(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === illegalKnight.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: 0x200, code: eventFreeChain, event: "quick", id: `lua-1-${eventFreeChain}`, property: undefined, range: ["hand"] },
      { category: 0x2008, code: eventFreeChain, event: "quick", id: `lua-2-${eventFreeChain}`, property: 0x10, range: ["monsterZone"] },
    ]);

    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === illegalKnight.uid && action.effectId === `lua-1-${eventFreeChain}`);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === illegalKnight.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: illegalKnight.uid,
      reasonEffectId: 1,
    });
  });

  it("restores Adventurer-token-gated Quick Effect that gives control and returns opponent cards to hand", () => {
    const { workspace, reader, session } = createFixture(42198836);
    const illegalKnight = requireCard(session, illegalKnightCode);
    const adventurerToken = requireCard(session, adventurerTokenCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    moveFaceUpAttack(session, illegalKnight, 0);
    moveFaceUpAttack(session, adventurerToken, 0);
    moveFaceUpAttack(session, opponentMonster, 1);
    const movedSpell = moveDuelCard(session.state, opponentSpell.uid, "spellTrapZone", 1);
    movedSpell.faceUp = true;
    movedSpell.position = "faceUpAttack";
    prepareMainPhase(session);
    registerIllegalKnight(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const bounce = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === illegalKnight.uid && action.effectId === `lua-2-${eventFreeChain}`);
    expect(bounce, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, bounce!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === illegalKnight.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: illegalKnight.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: illegalKnight.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: illegalKnight.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["controlChanged", "sentToHand"].includes(event.eventName)).map((event) => ({
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
    }))).toEqual(expect.arrayContaining([
      { eventName: "controlChanged", eventCardUid: illegalKnight.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: illegalKnight.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "monsterZone", previousController: 0, currentController: 1 },
      { eventName: "sentToHand", eventCardUid: opponentMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: illegalKnight.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "hand", previousController: 1, currentController: 1 },
      { eventName: "sentToHand", eventCardUid: opponentSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: illegalKnight.uid, eventReasonEffectId: 2, previous: "spellTrapZone", current: "hand", previousController: 1, currentController: 1 },
    ]));
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
  loadDecks(session, {
    0: { main: [illegalKnightCode, adventurerTokenCode] },
    1: { main: [opponentMonsterCode, opponentSpellCode] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: illegalKnightCode, name: "Illegal Knight", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 7, attack: 2000, defense: 2000 },
    { code: adventurerTokenCode, name: "Adventurer Token", kind: "monster", typeFlags: typeMonster | typeToken, race: raceFairy, attribute: attributeEarth, level: 4, attack: 2000, defense: 2000 },
    { code: opponentMonsterCode, name: "Illegal Knight Return Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: opponentSpellCode, name: "Illegal Knight Return Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Illegal Knight");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("Duel.IsMainPhase() and (Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)==0 or s.bravecon(e,tp))");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_CONTROL+CATEGORY_TOHAND)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,TOKEN_ADVENTURER),tp,LOCATION_ONFIELD,0,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToHand,tp,0,LOCATION_ONFIELD,1,2,nil)");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
  expect(script).toContain("Duel.GetTargetCards(e)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerIllegalKnight(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(illegalKnightCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
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
