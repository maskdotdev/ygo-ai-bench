import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const slayerCode = "4388680";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSlayerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${slayerCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeRitual = 0x80;
const typeEffect = 0x20;
const raceZombie = 0x8;
const setVendread = 0x106;

describe.skipIf(!hasUpstreamScripts || !hasSlayerScript)("Lua real script Revendread Slayer banish stat search send", () => {
  it("restores ritual-to-grave search then send and tracks battle banish-cost stat script coverage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const battleTargetCode = "43886800";
    const zombieCostCode = "43886801";
    const ritualSpellCode = "43886802";
    const vendreadSendCode = "43886803";
    const script = workspace.readScript(`official/c${slayerCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("return e:GetHandler():GetBattleTarget()~=nil");
    expect(script).toContain("return c:IsRace(RACE_ZOMBIE) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
    expect(script).toContain("c:RegisterFlagEffect(id,RESET_CHAIN,0,1)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,c)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(300)");
    expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return c:IsPreviousLocation(LOCATION_MZONE) and c:IsRitualSummoned()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("return c:IsRitualSpell() and c:IsAbleToHand()");
    expect(script).toContain("return c:IsMonster() and c:IsSetCard(SET_VENDREAD) and c:IsAbleToGrave()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(hg,tp,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,hg)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: slayerCode, name: "Revendread Slayer", kind: "monster", typeFlags: typeMonster | typeRitual | typeEffect, race: raceZombie, level: 6, attack: 2400, defense: 0, setcodes: [setVendread] },
      { code: battleTargetCode, name: "Revendread Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
      { code: zombieCostCode, name: "Revendread Zombie Cost", kind: "monster", typeFlags: typeMonster, race: raceZombie, level: 4, attack: 1000, defense: 1000 },
      { code: ritualSpellCode, name: "Revendread Ritual Spell", kind: "spell", typeFlags: typeSpell | typeRitual },
      { code: vendreadSendCode, name: "Revendread Deck Send", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setVendread], level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4388680, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [slayerCode, zombieCostCode, ritualSpellCode, vendreadSendCode] }, 1: { main: [battleTargetCode] } });
    startDuel(session);

    const slayer = requireCard(session, slayerCode);
    const ritualSpell = requireCard(session, ritualSpellCode);
    const vendreadSend = requireCard(session, vendreadSendCode);
    moveFaceUpAttack(session, slayer, 0);
    slayer.summonType = "ritual";
    moveDuelCard(session.state, requireCard(session, battleTargetCode).uid, "monsterZone", 1).faceUp = true;
    moveFaceUpAttack(session, requireCard(session, zombieCostCode), 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(slayerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    sendDuelCardToGraveyard(session.state, slayer.uid, 0, duelReason.effect, 0);
    const restoredGrave = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const searchTrigger = getLuaRestoreLegalActions(restoredGrave, 0).find((action) => action.type === "activateTrigger" && action.uid === slayer.uid);
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    expect(searchTrigger).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredGrave, searchTrigger!);
    resolveRestoredChain(restoredGrave);

    expect(restoredGrave.session.state.cards.find((card) => card.uid === ritualSpell.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredGrave.session.state.cards.find((card) => card.uid === vendreadSend.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredGrave.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: slayer.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: ritualSpell.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: slayer.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: ritualSpell.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [ritualSpell.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: slayer.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: ritualSpell.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [ritualSpell.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: slayer.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: vendreadSend.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: slayer.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
