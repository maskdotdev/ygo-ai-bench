import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const rendezvousCode = "96378317";
const linkedBeastCode = "963783170";
const linkedWingedBeastCode = "963783171";
const unlinkedBeastWarriorCode = "963783172";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRendezvousScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rendezvousCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const typeSpell = 0x2;
const typeQuickplay = 0x10000;
const raceBeast = 0x4000;
const raceWingedBeast = 0x80;
const raceBeastWarrior = 0x800000;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasRendezvousScript)("Lua real script Tri-Brigade Rendezvous linked stat replace", () => {
  it("restores linked Beast-family ATK gain and Graveyard destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rendezvousCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 96378317, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rendezvousCode, linkedWingedBeastCode, unlinkedBeastWarriorCode], extra: [linkedBeastCode] }, 1: { main: [] } });
    startDuel(session);
    const rendezvous = requireCard(session, rendezvousCode);
    const linkedBeast = requireCard(session, linkedBeastCode);
    const linkedWingedBeast = requireCard(session, linkedWingedBeastCode);
    const unlinkedBeastWarrior = requireCard(session, unlinkedBeastWarriorCode);
    moveDuelCard(session.state, rendezvous.uid, "hand", 0);
    moveFaceUpAttack(session, linkedBeast, 0, 1);
    moveFaceUpAttack(session, linkedWingedBeast, 0, 2);
    moveFaceUpAttack(session, unlinkedBeastWarrior, 0, 4);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rendezvousCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === rendezvous.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, linkedBeast.uid), restored.session.state)).toBe(2200);
    expect(currentAttack(findCard(restored.session, linkedWingedBeast.uid), restored.session.state)).toBe(1200);
    expect(currentAttack(findCard(restored.session, unlinkedBeastWarrior.uid), restored.session.state)).toBe(1300);
    expect(findCard(restored.session, rendezvous.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === linkedBeast.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: linkedBeast.uid, value: 700 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: linkedBeast.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1 },
      { eventCardUid: rendezvous.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredReplacement = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredReplacement);
    expectRestoredLegalActions(restoredReplacement, 0);
    destroyDuelCard(restoredReplacement.session.state, linkedBeast.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredReplacement.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 96, returned: true });
    expect(findCard(restoredReplacement.session, linkedBeast.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(findCard(restoredReplacement.session, rendezvous.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: rendezvous.uid,
      reasonEffectId: 2,
    });
    expect(restoredReplacement.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      {
        eventCardUid: rendezvous.uid,
        eventCode: 1011,
        eventName: "banished",
        eventReason: duelReason.effect,
        eventReasonCardUid: rendezvous.uid,
        eventReasonEffectId: 2,
        eventReasonPlayer: 0,
        previousLocation: "graveyard",
        currentLocation: "banished",
      },
    ]);
    expect(restoredReplacement.session.state.log).toContainEqual(expect.objectContaining({ action: "destroyReplace", player: 0, card: linkedBeast.name, detail: "Destruction replaced" }));
  });
});

function cards(): DuelCardData[] {
  return [
    { code: rendezvousCode, name: "Tri-Brigade Rendezvous", kind: "spell", typeFlags: typeSpell | typeQuickplay },
    { code: linkedBeastCode, name: "Rendezvous Linked Beast Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceBeast, level: 2, attack: 1500, defense: 0, linkMarkers: 0x20 },
    { code: linkedWingedBeastCode, name: "Rendezvous Linked Winged Beast", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, level: 4, attack: 1200, defense: 1000 },
    { code: unlinkedBeastWarriorCode, name: "Rendezvous Unlinked Beast-Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, level: 4, attack: 1300, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Tri-Brigade Rendezvous");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("c:IsRace(RACES_BEAST_BWARRIOR_WINGB)");
  expect(script).toContain("c:IsLinked()");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.filter,tp,LOCATION_MZONE,0,nil,e)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,n,nil,e)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS):Filter(Card.IsRelateToEffect,nil,e)");
  expect(script).toContain("EFFECT_UPDATE_ATTACK");
  expect(script).toContain("e1:SetValue(700)");
  expect(script).toContain("e2:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
  expect(script).toContain("Duel.Remove(e:GetHandler(),POS_FACEUP,REASON_EFFECT)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
