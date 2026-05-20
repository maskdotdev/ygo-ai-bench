import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const setNordic = 0x42;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mara of the Nordic Alfar hand Synchro", () => {
  it("restores EFFECT_HAND_SYNCHRO materials from hand for a matching Nordic Synchro Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const maraCode = "73417207";
    const synchroCode = "73417208";
    const nordicAcode = "73417209";
    const nordicBcode = "73417210";
    const offSetCode = "73417211";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === maraCode),
      { code: synchroCode, name: "Mara Hand Synchro Target", kind: "extra", typeFlags: 0x2001, level: 10, attack: 3000, defense: 2500 },
      { code: nordicAcode, name: "Nordic Hand Level 4 A", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1000, setcodes: [setNordic] },
      { code: nordicBcode, name: "Nordic Hand Level 4 B", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1000, setcodes: [setNordic] },
      { code: offSetCode, name: "Off-Set Hand Level 4", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 73417207, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [maraCode, nordicAcode, nordicBcode, offSetCode], extra: [synchroCode] }, 1: { main: [] } });
    startDuel(session);

    const mara = requireCard(session, maraCode);
    const synchro = requireCard(session, synchroCode);
    const nordicA = requireCard(session, nordicAcode);
    const nordicB = requireCard(session, nordicBcode);
    const offSet = requireCard(session, offSetCode);
    moveDuelCard(session.state, mara.uid, "monsterZone", 0);
    moveDuelCard(session.state, nordicA.uid, "hand", 0);
    moveDuelCard(session.state, nordicB.uid, "hand", 0);
    moveDuelCard(session.state, offSet.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(maraCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(workspace.readScript(`c${maraCode}.lua`)).toContain("e3:SetCode(EFFECT_HAND_SYNCHRO)");
    expect(workspace.readScript(`c${maraCode}.lua`)).toContain("return #sg==3,false");
    expect(session.state.cards.find((card) => card.uid === mara.uid)?.data).toMatchObject({
      handSynchroMaterialSetcode: setNordic,
      handSynchroMaterialCount: 3,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === mara.uid)?.data).toMatchObject({
      handSynchroMaterialSetcode: setNordic,
      handSynchroMaterialCount: 3,
    });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "synchroSummon" && action.materialUids.includes(offSet.uid))).toBe(false);

    const handSynchro = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "synchroSummon" && action.uid === synchro.uid);
    expect(handSynchro, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toEqual({
      type: "synchroSummon",
      player: 0,
      uid: synchro.uid,
      materialUids: [mara.uid, nordicA.uid, nordicB.uid],
      label: "Synchro Summon Mara Hand Synchro Target using Mara of the Nordic Alfar, Nordic Hand Level 4 A, Nordic Hand Level 4 B",
      windowId: 0,
      windowKind: "open",
      windowToken: "window-2",
    });
    const summoned = applyLuaRestoreResponse(restored, handSynchro!);
    expect(summoned.ok, summoned.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === synchro.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "synchro",
      summonMaterialUids: [mara.uid, nordicA.uid, nordicB.uid],
    });
    for (const material of [mara, nordicA, nordicB]) {
      expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.material | duelReason.synchro,
      });
    }
    expect(restored.session.state.cards.find((card) => card.uid === offSet.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
    }))).toEqual([
      { eventCardUid: mara.uid, eventReason: duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: synchro.uid },
      { eventCardUid: nordicA.uid, eventReason: duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: synchro.uid },
      { eventCardUid: nordicB.uid, eventReason: duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: synchro.uid },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: synchro.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "extraDeck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
