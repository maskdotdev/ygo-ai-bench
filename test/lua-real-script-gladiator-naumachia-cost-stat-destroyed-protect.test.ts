import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const naumachiaCode = "52394047";
const targetCode = "523940470";
const costCode = "523940471";
const opponentCode = "523940472";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNaumachiaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${naumachiaCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const setGladiator = 0x19;
const raceBeastWarrior = 0x4000;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectIndestructableBattle = 42;
const effectMustAttack = 191;

describe.skipIf(!hasUpstreamScripts || !hasNaumachiaScript)("Lua real script Gladiator Naumachia cost stat destroyed protect", () => {
  it("restores Gladiator Beast to-Deck cost, DEF-based ATK boost, must-attack field lock, and destroyed battle protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${naumachiaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createNaumachiaSession(reader, workspace);
    const naumachia = requireCard(session, naumachiaCode);
    const target = requireCard(session, targetCode);
    const cost = requireCard(session, costCode);
    const opponent = requireCard(session, opponentCode);

    moveFaceUpSpell(session, naumachia, 0, 0);
    moveFaceUpAttack(session, target, 0, 0);
    target.data.defense = 2000;
    moveDuelCard(session.state, cost.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, opponent, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === naumachia.uid && effect.code === effectMustAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectMustAttack, event: "continuous", range: ["spellTrapZone"], targetRange: [0, 0x04] },
    ]);

    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === naumachia.uid && action.effectId.includes("lua-3")
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    resolveRestoredChain(restoredOpen);

    expect(findCard(restoredOpen.session, cost.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: naumachia.uid,
    });
    expect(currentAttack(findCard(restoredOpen.session, target.uid), restoredOpen.session.state)).toBe(3000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x20000, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, value: 2000 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredBoosted = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoosted);
    expectRestoredLegalActions(restoredBoosted, 0);
    expect(currentAttack(findCard(restoredBoosted.session, target.uid), restoredBoosted.session.state)).toBe(3000);

    const destroyedWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(destroyedWindow);
    expectRestoredLegalActions(destroyedWindow, 0);
    destroyDuelCard(destroyedWindow.session.state, naumachia.uid, 0, duelReason.effect | duelReason.destroy, 1);
    const destroyedTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(destroyedWindow.session), workspace, reader);
    expectCleanRestore(destroyedTriggerWindow);
    expectRestoredLegalActions(destroyedTriggerWindow, 0);
    const protect = getLuaRestoreLegalActions(destroyedTriggerWindow, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === naumachia.uid
    );
    expect(protect, JSON.stringify(getLuaRestoreLegalActions(destroyedTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(destroyedTriggerWindow, protect!);
    resolveRestoredChain(destroyedTriggerWindow);

    expect(destroyedTriggerWindow.session.state.effects.filter((effect) => effect.code === effectIndestructableBattle).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructableBattle, event: "continuous", property: 0x4000080, reset: { flags: 0x40000200 }, sourceUid: naumachia.uid, targetRange: [0x04, 0], value: 1 },
    ]);
    expect(destroyedTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "destroyed").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: naumachia.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gladiator Naumachia");
  expect(script).toContain("e2:SetCode(EFFECT_MUST_ATTACK)");
  expect(script).toContain("e3:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcfilter,tp,LOCATION_HAND|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetBaseDefense())");
  expect(script).toContain("e4:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_GLADIATOR))");
}

function cards(): DuelCardData[] {
  return [
    { code: naumachiaCode, name: "Gladiator Naumachia", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: targetCode, name: "Gladiator Beast Boost Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGladiator], race: raceBeastWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 2000 },
    { code: costCode, name: "Gladiator Beast Deck Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGladiator], race: raceBeastWarrior, attribute: attributeEarth, level: 4, attack: 800, defense: 1200 },
    { code: opponentCode, name: "Naumachia Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
  ];
}

function createNaumachiaSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 52394047, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [naumachiaCode, targetCode, costCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(naumachiaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
  assertResponse(restored.session, response);
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

function assertResponse(session: DuelSession, response: ReturnType<typeof applyResponse>): void {
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
