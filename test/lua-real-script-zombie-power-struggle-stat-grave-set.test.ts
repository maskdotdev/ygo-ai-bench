import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const struggleCode = "65357623";
const zombieCode = "653576230";
const banishedZombieCode = "653576231";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasStruggleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${struggleCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeQuickPlay = 0x10000;
const raceZombie = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasStruggleScript)("Lua real script Zombie Power Struggle stat grave set", () => {
  it("restores targeted Zombie SelectYesNo into a temporary ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${struggleCode}.lua`));
    const reader = createCardReader(cards());
    const session = createStruggleSession(reader, workspace);
    const struggle = requireCard(session, struggleCode);
    const zombie = requireCard(session, zombieCode);
    moveFaceDownSpell(session, struggle);
    moveFaceUpAttack(session, zombie, 0);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === struggle.uid && action.effectId === "lua-1-1002");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions).toEqual([{ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1045721968, returned: true }]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === zombie.uid), restoredOpen.session.state)).toBe(500);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === zombie.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 1107169792 }, sourceUid: zombie.uid, value: -1000 }]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === struggle.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget" && event.eventCardUid === zombie.uid)).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: zombie.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === zombie.uid), restoredStat.session.state)).toBe(500);
  });

  it("restores banished Zombie to Deck into Graveyard self-Set and leave-field redirect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${struggleCode}.lua`));
    const reader = createCardReader(cards());
    const session = createStruggleSession(reader, workspace);
    const struggle = requireCard(session, struggleCode);
    const banishedZombie = requireCard(session, banishedZombieCode);
    moveDuelCard(session.state, struggle.uid, "graveyard", 0);
    moveDuelCard(session.state, banishedZombie.uid, "banished", 0).faceUp = true;

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const setAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === struggle.uid && action.effectId === "lua-2");
    expect(setAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, setAction!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === banishedZombie.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      faceUp: true,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === struggle.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      position: "faceDown",
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === struggle.uid && effect.code === 60).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: 60, property: 0x400 | 0x4000000, reset: { flags: 209326080 }, sourceUid: struggle.uid, value: 0x20 }]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck" && event.eventCardUid === banishedZombie.uid)).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: banishedZombie.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: struggle.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 1 },
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "spellTrapSet" && event.eventCardUid === struggle.uid)).toEqual([
      {
        eventName: "spellTrapSet",
        eventCode: 1107,
        eventCardUid: struggle.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredSet = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSet);
    expectRestoredLegalActions(restoredSet, 0);
    expect(restoredSet.session.state.cards.find((card) => card.uid === struggle.uid)).toMatchObject({ location: "spellTrapZone", faceUp: false });
    expect(restoredSet.session.state.effects.filter((effect) => effect.sourceUid === struggle.uid && effect.code === 60).map((effect) => effect.value)).toEqual([0x20]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_ZOMBIE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("if Duel.SelectYesNo(tp,aux.Stringid(id,0)) then atk=atk*-1 end");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TODECK+CATEGORY_SET)");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_ZOMBIE) and c:IsAbleToDeck()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)>0");
  expect(script).toContain("Duel.SSet(tp,c)");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
  expect(script).toContain("e1:SetValue(LOCATION_REMOVED)");
}

function cards(): DuelCardData[] {
  return [
    { code: struggleCode, name: "Zombie Power Struggle", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    { code: zombieCode, name: "Zombie Power Struggle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1500, defense: 1200 },
    { code: banishedZombieCode, name: "Zombie Power Struggle Banished Zombie", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createStruggleSession(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): DuelSession {
  const session = createDuel({ seed: 65357623, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [struggleCode, zombieCode, banishedZombieCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(struggleCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownSpell(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
