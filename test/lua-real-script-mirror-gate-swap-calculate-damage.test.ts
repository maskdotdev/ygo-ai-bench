import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mirror Gate SwapControl CalculateDamage", () => {
  it("restores attack-announcement SwapControl into CalculateDamage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mirrorGateCode = "43452193";
    const attackerCode = "43452194";
    const heroCode = "43452195";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mirrorGateCode),
      { code: attackerCode, name: "Mirror Gate Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
      { code: heroCode, name: "Mirror Gate Elemental HERO", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000, setcodes: [0x3008] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 434, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mirrorGateCode, heroCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const mirrorGate = session.state.cards.find((card) => card.code === mirrorGateCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const hero = session.state.cards.find((card) => card.code === heroCode);
    expect(mirrorGate).toBeDefined();
    expect(attacker).toBeDefined();
    expect(hero).toBeDefined();
    moveDuelCard(session.state, mirrorGate!.uid, "spellTrapZone", 0);
    mirrorGate!.position = "faceDown";
    mirrorGate!.faceUp = false;
    moveDuelCard(session.state, hero!.uid, "monsterZone", 0);
    hero!.position = "faceUpAttack";
    hero!.faceUp = true;
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const script = workspace.readScript(`c${mirrorGateCode}.lua`);
    expect(script).toContain("Duel.SwapControl(a,at,RESET_PHASE|PHASE_END,1)");
    expect(script).toContain("Duel.CalculateDamage(a,at)");
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mirrorGateCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === hero!.uid,
    );
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    if (session.state.waitingFor === 1) {
      const turnPlayerPass = getLegalActions(session, 1).find((action) => action.type === "passAttack");
      expect(turnPlayerPass, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
      applyAndAssert(session, turnPlayerPass!);
    }

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.battleWindow?.kind).toBe("attackNegationResponse");
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const restoredActivation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === mirrorGate!.uid);
    expect(restoredActivation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, restoredActivation!);
    expect(activated.ok, activated.error).toBe(true);
    resolveRestoredChain(restored);

    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.cards.find((card) => card.uid === mirrorGate!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === hero!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(7200);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 800 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "controlChanged").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventCardUid: attacker!.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: mirrorGate!.uid, eventReasonEffectId: 1, eventUids: undefined },
      { eventCardUid: hero!.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: mirrorGate!.uid, eventReasonEffectId: 1, eventUids: undefined },
      { eventCardUid: attacker!.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: mirrorGate!.uid, eventReasonEffectId: 1, eventUids: [attacker!.uid, hero!.uid] },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["battleDamageDealt", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacker!.uid,
        eventPlayer: 1,
        eventValue: 800,
        eventPreviousState: {
          controller: 1,
          location: "monsterZone",
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.battle,
        eventReasonCardUid: attacker!.uid,
        eventReasonEffectId: 1,
        eventReasonPlayer: 0,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: hero!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: attacker!.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}
