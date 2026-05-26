import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Switcheroroo group SwapControl", () => {
  it("restores same-size field groups into grouped SwapControl events", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const switcherorooCode = "30426226";
    const ownA = "30426227";
    const ownB = "30426228";
    const opponentA = "30426229";
    const opponentB = "30426230";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === switcherorooCode),
      { code: ownA, name: "Switcheroroo Own A", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: ownB, name: "Switcheroroo Own B", kind: "monster", typeFlags: 0x1, level: 4, attack: 1100, defense: 1000 },
      { code: opponentA, name: "Switcheroroo Opponent A", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      { code: opponentB, name: "Switcheroroo Opponent B", kind: "monster", typeFlags: 0x1, level: 4, attack: 1300, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 304, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [switcherorooCode, ownA, ownB] }, 1: { main: [opponentA, opponentB] } });
    startDuel(session);

    const switcheroroo = session.state.cards.find((card) => card.code === switcherorooCode);
    const ownFirst = session.state.cards.find((card) => card.code === ownA);
    const ownSecond = session.state.cards.find((card) => card.code === ownB);
    const opponentFirst = session.state.cards.find((card) => card.code === opponentA);
    const opponentSecond = session.state.cards.find((card) => card.code === opponentB);
    expect(switcheroroo).toBeDefined();
    expect(ownFirst).toBeDefined();
    expect(ownSecond).toBeDefined();
    expect(opponentFirst).toBeDefined();
    expect(opponentSecond).toBeDefined();

    moveDuelCard(session.state, switcheroroo!.uid, "spellTrapZone", 0);
    switcheroroo!.position = "faceDown";
    switcheroroo!.faceUp = false;
    moveDuelCard(session.state, ownFirst!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, ownSecond!.uid, "monsterZone", 0).position = "faceUpAttack";
    ownFirst!.sequence = 0;
    ownSecond!.sequence = 1;
    moveDuelCard(session.state, opponentFirst!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentSecond!.uid, "monsterZone", 1).position = "faceUpAttack";
    opponentFirst!.sequence = 0;
    opponentSecond!.sequence = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const script = workspace.readScript(`c${switcherorooCode}.lua`);
    expect(script).toContain("Duel.SwapControl(g1,g2)");
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(switcherorooCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === switcheroroo!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, activation!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restored.session.state.chain).toEqual([]);

    expect(restored.session.state.cards.find((card) => card.uid === switcheroroo!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === ownFirst!.uid)).toMatchObject({ location: "monsterZone", controller: 1, previousController: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === ownSecond!.uid)).toMatchObject({ location: "monsterZone", controller: 1, previousController: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentFirst!.uid)).toMatchObject({ location: "monsterZone", controller: 0, previousController: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentSecond!.uid)).toMatchObject({ location: "monsterZone", controller: 0, previousController: 1 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "controlChanged").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventCardUid: ownFirst!.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: switcheroroo!.uid, eventReasonEffectId: 1, eventUids: undefined },
      { eventCardUid: opponentFirst!.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: switcheroroo!.uid, eventReasonEffectId: 1, eventUids: undefined },
      { eventCardUid: ownSecond!.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: switcheroroo!.uid, eventReasonEffectId: 1, eventUids: undefined },
      { eventCardUid: opponentSecond!.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: switcheroroo!.uid, eventReasonEffectId: 1, eventUids: undefined },
      {
        eventCardUid: ownFirst!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: switcheroroo!.uid,
        eventReasonEffectId: 1,
        eventUids: [ownFirst!.uid, opponentFirst!.uid, ownSecond!.uid, opponentSecond!.uid],
      },
    ]);
  });
});
