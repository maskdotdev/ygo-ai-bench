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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const akashicCode = "28776350";
const mutualLinkCode = "287763501";
const announcedCode = "75505728";
const excavatedCode = "1002";
const typeMonster = 0x1;
const typeLink = 0x4000000;
const raceSpellcaster = 0x2;
const raceCyberse = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Akashic Magician mutual-linked excavate", () => {
  it("restores GetMutualLinkedGroup Link-sum announce, decktop confirm, search, and excavate send", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${akashicCode}.lua`);
    expect(script).toContain("Link.AddProcedure(c,s.filter,2,nil,s.spcheck)");
    expect(script).toContain("return g:CheckSameProperty(Card.GetRace,lc,SUMMON_TYPE_LINK,tp)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("local lg=c:GetMutualLinkedGroup():Filter(Card.IsMonster,nil)");
    expect(script).toContain("local ct=lg:GetSum(Card.GetLink)");
    expect(script).toContain("Duel.IsPlayerCanDiscardDeck(tp,ct)");
    expect(script).toContain("Duel.GetDecktopGroup(tp,ct)");
    expect(script).toContain("s.announce_filter={TYPE_EXTRA,OPCODE_ISTYPE,OPCODE_NOT}");
    expect(script).toContain("Duel.AnnounceCard(tp,table.unpack(s.announce_filter))");
    expect(script).toContain("Duel.SetTargetParam(ac)");
    expect(script).toContain("Duel.ConfirmDecktop(tp,ct)");
    expect(script).toContain("Duel.DisableShuffleCheck()");
    expect(script).toContain("Duel.SendtoHand(hg,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT|REASON_EXCAVATE)");

    const cards: DuelCardData[] = [
      { code: akashicCode, name: "Akashic Magician", kind: "extra", typeFlags: typeMonster | typeLink, level: 2, attack: 1700, defense: 0, race: raceSpellcaster, linkMarkers: 0x20 },
      { code: mutualLinkCode, name: "Akashic Mutual Link Fixture", kind: "extra", typeFlags: typeMonster | typeLink, level: 2, attack: 1000, defense: 0, race: raceCyberse, linkMarkers: 0x8 },
      { code: announcedCode, name: "Akashic Announced Deck Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000, race: raceCyberse },
      { code: excavatedCode, name: "Akashic Excavated Deck Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1300, defense: 1000, race: raceCyberse },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 28776350, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [announcedCode, excavatedCode], extra: [akashicCode, mutualLinkCode] }, 1: { main: [] } });
    startDuel(session);

    const akashic = requireCard(session, akashicCode);
    const mutualLink = requireCard(session, mutualLinkCode);
    const announced = requireCard(session, announcedCode);
    const excavated = requireCard(session, excavatedCode);
    moveFaceUpLink(session, akashic.uid, 0);
    moveFaceUpLink(session, mutualLink.uid, 0);
    akashic.summonType = "link";
    mutualLink.summonType = "link";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(akashicCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).not.toContain("unsupported");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === akashic.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);

    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [Number(announcedCode)], descriptions: [Number(announcedCode)], returned: Number(announcedCode) },
    ]);
    expect(restored.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === akashic.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === mutualLink.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === announced.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: akashic.uid,
      reasonEffectId: 4,
    });
    expect(restored.session.state.cards.find((card) => card.uid === excavated.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.excavate,
      reasonPlayer: 0,
      reasonCardUid: akashic.uid,
      reasonEffectId: 4,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["deckTopConfirmed", "sentToHand", "confirmed", "sentToHandConfirmed", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: excavated.uid,
        eventPlayer: 0,
        eventValue: 2,
        eventUids: [excavated.uid, announced.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: announced.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: akashic.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: announced.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [announced.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: akashic.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: announced.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [announced.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: akashic.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: excavated.uid,
        eventReason: duelReason.effect | duelReason.excavate,
        eventReasonPlayer: 0,
        eventReasonCardUid: akashic.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function moveFaceUpLink(session: DuelSession, uid: string, controller: PlayerId): DuelCardInstance {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
  return card;
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
