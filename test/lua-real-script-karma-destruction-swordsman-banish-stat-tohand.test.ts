import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const karmaCode = "78348934";
const busterTargetCode = "783489340";
const opponentWarriorCode = "783489341";
const opponentDragonCode = "783489342";
const discardSwordCode = "783489343";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasKarmaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${karmaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceDragon = 0x2000;
const attributeDark = 0x20;
const setDestructionSword = 0xd6;
const setBusterBlader = 0xd7;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasKarmaScript)("Lua real script Karma of the Destruction Swordsman banish stat tohand", () => {
  it("restores SelectUnselectGroup grave banish stat boost and grave discard return to hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${karmaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const karma = requireCard(restoredOpen.session, karmaCode);
    const busterTarget = requireCard(restoredOpen.session, busterTargetCode);
    const opponentWarrior = requireCard(restoredOpen.session, opponentWarriorCode);
    const opponentDragon = requireCard(restoredOpen.session, opponentDragonCode);
    const discardSword = requireCard(restoredOpen.session, discardSwordCode);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === karma.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === karma.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentWarrior.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: karma.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentDragon.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === busterTarget.uid), restoredOpen.session.state)).toBe(2100);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === busterTarget.uid), restoredOpen.session.state)).toBe(1700);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === busterTarget.uid && (effect.code === 100 || effect.code === 104)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792 }, sourceUid: busterTarget.uid, value: 500 },
      { code: 104, reset: { flags: 1107169792 }, sourceUid: busterTarget.uid, value: 500 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentWarrior.uid, eventPlayer: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "graveyard" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentWarrior.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: karma.uid, eventReasonEffectId: 1, previous: "graveyard", current: "banished" },
    ]);

    const restoredGrave = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredGrave);
    restoredGrave.session.state.turnPlayer = 0;
    restoredGrave.session.state.phase = "main1";
    restoredGrave.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredGrave, 0);
    const returnToHand = getLuaRestoreLegalActions(restoredGrave, 0).find((action) => action.type === "activateEffect" && action.uid === karma.uid);
    expect(returnToHand, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    const graveEventStart = restoredGrave.session.state.eventHistory.length;
    applyRestoredActionAndAssert(restoredGrave, returnToHand!);
    resolveRestoredChain(restoredGrave);

    expect(restoredGrave.session.state.cards.find((card) => card.uid === discardSword.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: karma.uid,
      reasonEffectId: 2,
    });
    expect(restoredGrave.session.state.cards.find((card) => card.uid === karma.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: karma.uid,
      reasonEffectId: 2,
    });
    expect(restoredGrave.session.state.eventHistory.slice(graveEventStart).filter((event) => ["discarded", "sentToHand"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "discarded", eventCode: 1018, eventCardUid: discardSword.uid, eventPlayer: undefined, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: karma.uid, eventReasonEffectId: 2, previous: "hand", current: "graveyard" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: karma.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: karma.uid, eventReasonEffectId: 2, previous: "graveyard", current: "hand" },
    ]);
    expect(restoredGrave.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 78348934, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [karmaCode, busterTargetCode, discardSwordCode] }, 1: { main: [opponentWarriorCode, opponentDragonCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, karmaCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, busterTargetCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, discardSwordCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, opponentWarriorCode).uid, "graveyard", 1).faceUp = true;
  moveDuelCard(session.state, requireCard(session, opponentDragonCode).uid, "graveyard", 1).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(karmaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Karma of the Destruction Swordsman");
  expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,1,3,s.rescon,1,tp,HINTMSG_REMOVE)");
  expect(script).toContain("Duel.SetTargetCard(rg)");
  expect(script).toContain("Duel.GetTargetCards(e)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("Duel.DiscardHand(tp,s.cfilter,1,1,REASON_DISCARD|REASON_COST)");
  expect(script).toContain("Duel.SendtoHand(e:GetHandler(),nil,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const karma = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === karmaCode);
  expect(karma).toBeDefined();
  return [
    karma!,
    { code: busterTargetCode, name: "Karma Buster Blader Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, setcodes: [setBusterBlader], level: 4, attack: 1600, defense: 1200 },
    { code: opponentWarriorCode, name: "Karma Opponent Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1400, defense: 1000 },
    { code: opponentDragonCode, name: "Karma Opponent Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1700, defense: 1500 },
    { code: discardSwordCode, name: "Karma Destruction Sword Discard", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, setcodes: [setDestructionSword], level: 4, attack: 1000, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
