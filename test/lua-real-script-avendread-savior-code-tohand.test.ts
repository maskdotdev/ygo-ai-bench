import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentCardCodes } from "#duel/card-code-state.js";
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
const saviorCode = "91420202";
const hasSaviorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${saviorCode}.lua`));
const vendreadCode = "914202020";
const nonVendreadCode = "914202021";
const revendreadSlayerCode = "4388680";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceZombie = 0x8;
const raceWarrior = 0x1;
const setVendread = 0x106;

describe.skipIf(!hasUpstreamScripts || !hasSaviorScript)("Lua real script Avendread Savior code and to-hand", () => {
  it("restores MZONE Revendread Slayer code and targeted Vendread grave-to-hand search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${saviorCode}.lua`);
    expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_ZOMBIE),2,2)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetValue(4388680)");
    expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsSetCard(SET_VENDREAD) and c:IsAbleToHand()");
    expect(script).toContain("Duel.IsExistingTarget(s.thfilter,tp,LOCATION_GRAVE,0,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,sg,#sg,0,0)");
    expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
    expect(script).toContain("e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcfilter,tp,LOCATION_DECK,0,1,1,nil):GetFirst()");
    expect(script).toContain("Duel.SendtoGrave(tc,REASON_COST)");
    expect(script).toContain("e:SetLabel(tc:GetLevel())");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");

    const cards: DuelCardData[] = [
      { code: saviorCode, name: "Avendread Savior", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceZombie, level: 2, attack: 1600, defense: 0, linkMarkers: 0x3 },
      { code: vendreadCode, name: "Avendread Grave Vendread", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, setcodes: [setVendread], level: 4, attack: 1800, defense: 1000 },
      { code: nonVendreadCode, name: "Avendread Grave Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 91420202, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vendreadCode, nonVendreadCode], extra: [saviorCode] }, 1: { main: [] } });
    startDuel(session);

    const savior = requireCard(session, saviorCode);
    const vendread = requireCard(session, vendreadCode);
    const decoy = requireCard(session, nonVendreadCode);
    moveFaceUpAttack(session, savior, 0);
    moveDuelCard(session.state, vendread.uid, "graveyard", 0);
    moveDuelCard(session.state, decoy.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(saviorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentCardCodes(restoredOpen.session.state.cards.find((card) => card.uid === savior.uid)!, restoredOpen.session.state)).toEqual([revendreadSlayerCode]);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === savior.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === vendread.uid)).toMatchObject({
      location: "hand",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: savior.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "sentToHand"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: vendread.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: vendread.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: savior.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentCardCodes(restoredResolved.session.state.cards.find((card) => card.uid === savior.uid)!, restoredResolved.session.state)).toEqual([revendreadSlayerCode]);
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function requireCard(session: DuelSession, code: string) {
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
