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
const doraCode = "11590299";
const topFireDragonCode = "115902990";
const deckFillerCode = "115902991";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDoraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${doraCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeEarth = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasDoraScript)("Lua real script Dora Dora Deck-top excavate stat", () => {
  it("restores Deck-top confirmation, excavate-to-Grave, shuffle check suppression, and UpdateAttack", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${doraCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("return c:IsLevelBelow(4) and c:IsAttribute(ATTRIBUTE_FIRE) and c:IsRace(RACE_DRAGON) and c:IsAbleToHand()");
    expect(script).toContain("e2:SetCategory(CATEGORY_DECKDES+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("Duel.ConfirmDecktop(tp,1)");
    expect(script).toContain("local tc=Duel.GetDecktopGroup(tp,1):GetFirst()");
    expect(script).toContain("Duel.DisableShuffleCheck()");
    expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT|REASON_EXCAVATE)");
    expect(script).toContain("e:GetHandler():UpdateAttack(ct*1000)");
    expect(script).toContain("Duel.MoveToDeckBottom(tc)");

    const cards: DuelCardData[] = [
      { code: doraCode, name: "Dora Dora", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 3, attack: 400, defense: 200 },
      { code: topFireDragonCode, name: "Dora Dora Excavated FIRE Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 4, attack: 1600, defense: 1200 },
      { code: deckFillerCode, name: "Dora Dora Deck Filler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 11590299, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [doraCode, topFireDragonCode, deckFillerCode] }, 1: { main: [] } });
    startDuel(session);

    const dora = requireCard(session, doraCode);
    const topFireDragon = requireCard(session, topFireDragonCode);
    const deckFiller = requireCard(session, deckFillerCode);
    moveFaceUpAttack(session, dora.uid, 0);
    setDeckSequence(topFireDragon, 0);
    setDeckSequence(deckFiller, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(doraCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === dora.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.host.messages).toContain(`confirmed decktop 0: ${topFireDragonCode}`);
    expect(restoredOpen.session.state.shuffleCheckDisabled).toBe(true);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === dora.uid), restoredOpen.session.state)).toBe(1400);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === topFireDragon.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.excavate,
      reasonPlayer: 0,
      reasonCardUid: dora.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === deckFiller.uid)).toMatchObject({ location: "deck", controller: 0, sequence: 1 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["confirmed", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: topFireDragon.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [topFireDragon.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: topFireDragon.uid,
        eventReason: duelReason.effect | duelReason.excavate,
        eventReasonPlayer: 0,
        eventReasonCardUid: dora.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === dora.uid), restoredResolved.session.state)).toBe(1400);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, controller: PlayerId): DuelCardInstance {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
  return card;
}

function setDeckSequence(card: DuelCardInstance, sequence: number): void {
  card.location = "deck";
  card.controller = 0;
  card.sequence = sequence;
  card.faceUp = false;
  card.position = "faceDown";
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
