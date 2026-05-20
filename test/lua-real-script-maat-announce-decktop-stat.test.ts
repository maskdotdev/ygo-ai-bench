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
const maatCode = "18631392";
const hitCode = "75505728";
const missCodeA = "186313922";
const missCodeB = "186313923";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMaatScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${maatCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasMaatScript)("Lua real script Maat announce decktop stat", () => {
  it("restores triple AnnounceCard into decktop reveal, hand hit, grave misses, and final stats", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${maatCode}.lua`);
    expect(script).toContain("Duel.AnnounceCard(tp,table.unpack(s.announce_filter))");
    expect(script).toContain("Duel.ConfirmDecktop(tp,3)");
    expect(script).toContain("local g=Duel.GetDecktopGroup(tp,3)");
    expect(script).toContain("Duel.DisableShuffleCheck()");
    expect(script).toContain("Duel.SendtoHand(hg,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,hg)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT|REASON_EXCAVATE)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");

    const cards: DuelCardData[] = [
      { code: maatCode, name: "Ma'at", kind: "monster", typeFlags: typeMonster | typeEffect, level: 10, attack: 0, defense: 0 },
      { code: hitCode, name: "Maat Announced Hit", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: missCodeA, name: "Maat Announced Miss A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: missCodeB, name: "Maat Announced Miss B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1300, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 18631392, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [maatCode, hitCode, missCodeA, missCodeB] }, 1: { main: [] } });
    startDuel(session);

    const maat = requireCard(session, maatCode);
    const hit = requireCard(session, hitCode);
    const missA = requireCard(session, missCodeA);
    const missB = requireCard(session, missCodeB);
    moveFaceUpAttack(session, maat, 0);
    hit.sequence = 0;
    missA.sequence = 1;
    missB.sequence = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(maatCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === maat.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(action).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredOpen, action!);

    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [Number(hitCode)], descriptions: [Number(hitCode)], returned: Number(hitCode) },
      { id: "lua-prompt-2", api: "AnnounceCard", player: 0, options: [Number(hitCode)], descriptions: [Number(hitCode)], returned: Number(hitCode) },
      { id: "lua-prompt-3", api: "AnnounceCard", player: 0, options: [Number(hitCode)], descriptions: [Number(hitCode)], returned: Number(hitCode) },
    ]);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === hit.uid)).toMatchObject({ location: "hand", controller: 0, reason: duelReason.effect, reasonCardUid: maat.uid });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === missA.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.excavate, reasonCardUid: maat.uid });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === missB.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.excavate, reasonCardUid: maat.uid });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === maat.uid), restoredOpen.session.state)).toBe(1000);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === maat.uid), restoredOpen.session.state)).toBe(1000);
    const events = restoredOpen.session.state.eventHistory;
    expect(events.filter((event) => event.eventName === "confirmed")).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: hit.uid,
        eventPlayer: 0,
        eventValue: 3,
        eventUids: [hit.uid, missA.uid, missB.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: hit.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [hit.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: maat.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(events.filter((event) => event.eventName === "sentToHand")).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: hit.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: maat.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(events.filter((event) => event.eventName === "sentToGraveyard" && event.eventUids === undefined)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: missA.uid,
        eventReason: duelReason.effect | duelReason.excavate,
        eventReasonPlayer: 0,
        eventReasonCardUid: maat.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: missB.uid,
        eventReason: duelReason.effect | duelReason.excavate,
        eventReasonPlayer: 0,
        eventReasonCardUid: maat.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
