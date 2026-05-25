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
const gotterdammerungCode = "91148083";
const aesirCode = "911480830";
const opponentMonsterCode = "911480831";
const opponentSpellCode = "911480832";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGotterdammerungScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gotterdammerungCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceDivineBeast = 0x2000000;
const raceWarrior = 0x1;
const attributeDivine = 0x40;
const attributeEarth = 0x1;
const setAesir = 0x4b;
const categoryControl = 0x2000;
const eventFreeChain = 1002;
const eventPhaseEnd = 4608;
const effectFlagCardTarget = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasGotterdammerungScript)("Lua real script Gotterdammerung control end banish", () => {
  it("restores Aesir control handoff into opponent End Phase destroy and opponent-field banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${gotterdammerungCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 91148083, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gotterdammerungCode, aesirCode] }, 1: { main: [opponentMonsterCode, opponentSpellCode] } });
    startDuel(session);

    const gotterdammerung = requireCard(session, gotterdammerungCode);
    const aesir = requireCard(session, aesirCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    setTrap(session, gotterdammerung);
    moveFaceUpAttack(session, aesir, 0, 0);
    moveFaceUpAttack(session, opponentMonster, 1, 0);
    const spell = moveDuelCard(session.state, opponentSpell.uid, "spellTrapZone", 1);
    spell.faceUp = true;
    spell.position = "faceUpAttack";
    prepareMainPhase(session);
    registerGotterdammerung(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === gotterdammerung.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: eventFreeChain, event: "quick", id: `lua-1-${eventFreeChain}`, property: effectFlagCardTarget, range: ["spellTrapZone"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === gotterdammerung.uid && action.effectId === `lua-1-${eventFreeChain}`
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, gotterdammerung.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(findCard(restored.session, aesir.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: gotterdammerung.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.effects.some((effect) =>
      effect.sourceUid === gotterdammerung.uid && effect.code === eventPhaseEnd && effect.event === "continuous"
    )).toBe(true);

    changePhase(restored, 0, "battle");
    changePhase(restored, 0, "main2");
    changePhase(restored, 0, "end");
    endTurn(restored, 0);
    changePhase(restored, 1, "battle");
    changePhase(restored, 1, "main2");
    changePhase(restored, 1, "end");

    expect(findCard(restored.session, aesir.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: gotterdammerung.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restored.session, opponentMonster.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: gotterdammerung.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restored.session, opponentSpell.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: gotterdammerung.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["destroyed", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual(expect.arrayContaining([
      { eventName: "destroyed", eventCardUid: aesir.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: gotterdammerung.uid, eventReasonEffectId: 2 },
      { eventName: "banished", eventCardUid: opponentMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: gotterdammerung.uid, eventReasonEffectId: 2 },
      { eventName: "banished", eventCardUid: opponentSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: gotterdammerung.uid, eventReasonEffectId: 2 },
    ]));
  });
});

function cards(): DuelCardData[] {
  return [
    { code: gotterdammerungCode, name: "Gotterdammerung", kind: "trap", typeFlags: typeTrap },
    { code: aesirCode, name: "Gotterdammerung Aesir", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDivineBeast, attribute: attributeDivine, setcodes: [setAesir], level: 10, attack: 3500, defense: 3000 },
    { code: opponentMonsterCode, name: "Gotterdammerung Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: opponentSpellCode, name: "Gotterdammerung Opponent Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gotterdammerung");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_AESIR) and c:IsControlerCanBeChanged()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,1-tp)");
  expect(script).toContain("tc:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,0,0)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsAbleToRemove,tp,0,LOCATION_ONFIELD,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerGotterdammerung(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gotterdammerungCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function setTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.turnId = 0;
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

function changePhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, phase: DuelSession["state"]["phase"]): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}

function endTurn(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "endTurn");
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
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
