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
const pendragonCode = "56619314";
const dragonReleaseCode = "566193140";
const fiendReleaseCode = "566193141";
const discardCode = "566193142";
const destroySpellCode = "566193143";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPendragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pendragonCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceFiend = 0x8;
const raceDragon = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasPendragonScript)("Lua real script D/D/D Dragon King Pendragon release discard stat", () => {
  it("restores Dragon+Fiend release-cost self summon and discard-cost optional Spell/Trap destroy after ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${pendragonCode}.lua`);
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,Card.IsRace,2,true,s.spcheck,e:GetHandler(),RACE_DRAGON|RACE_FIEND)");
    expect(script).toContain("aux.ReleaseCheckMMZ(sg,tp)");
    expect(script).toContain("c:IsRace(RACE_DRAGON) and sg:IsExists(Card.IsRace,1,c,RACE_FIEND)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,Card.IsRace,2,2,true,s.spcheck,e:GetHandler(),RACE_DRAGON|RACE_FIEND)");
    expect(script).toContain("Duel.Release(sg,REASON_COST)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(500)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
    expect(script).toContain("Duel.HintSelection(dg)");
    expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");

    const reader = createCardReader(cards());
    const summonSession = createDuel({ seed: 56619314, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(summonSession, { 0: { main: [pendragonCode, dragonReleaseCode, fiendReleaseCode] }, 1: { main: [] } });
    startDuel(summonSession);
    const handPendragon = requireCard(summonSession, pendragonCode);
    const dragon = requireCard(summonSession, dragonReleaseCode);
    const fiend = requireCard(summonSession, fiendReleaseCode);
    moveDuelCard(summonSession.state, handPendragon.uid, "hand", 0);
    moveFaceUpAttack(summonSession, dragon, 0);
    moveFaceUpAttack(summonSession, fiend, 0);
    summonSession.state.phase = "main1";
    summonSession.state.turnPlayer = 0;
    summonSession.state.waitingFor = 0;

    const summonHost = createLuaScriptHost(summonSession, workspace);
    expect(summonHost.loadCardScript(Number(pendragonCode), workspace).ok).toBe(true);
    expect(summonHost.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(summonSession), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonAction = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handPendragon.uid && action.effectId === "lua-1"
    );
    expect(summonAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonAction!);

    expect(restoredSummon.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === handPendragon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: handPendragon.uid,
      reasonEffectId: 1,
    });
    for (const material of [dragon, fiend]) {
      expect(restoredSummon.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.cost | duelReason.release,
        reasonPlayer: 0,
        reasonCardUid: handPendragon.uid,
        reasonEffectId: 1,
      });
    }
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["released", "specialSummoned", "chainSolved"].includes(event.eventName))).toEqual([
      releaseEvent(dragon, handPendragon, 1, 0),
      releaseEvent(fiend, handPendragon, 1, 1),
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: dragon.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: handPendragon.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventUids: [dragon.uid, fiend.uid],
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: handPendragon.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: handPendragon.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [handPendragon.uid],
      },
      { eventName: "chainSolved", eventCode: 1022, eventValue: 1, eventReasonPlayer: 0, eventPlayer: 0, eventChainDepth: 1, eventChainLinkId: "chain-4", relatedEffectId: 1 },
    ]);

    const ignitionSession = createDuel({ seed: 56619315, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(ignitionSession, { 0: { main: [pendragonCode, discardCode] }, 1: { main: [destroySpellCode] } });
    startDuel(ignitionSession);
    const fieldPendragon = requireCard(ignitionSession, pendragonCode);
    const discard = requireCard(ignitionSession, discardCode);
    const targetSpell = requireCard(ignitionSession, destroySpellCode, 1);
    moveFaceUpAttack(ignitionSession, fieldPendragon, 0);
    moveDuelCard(ignitionSession.state, discard.uid, "hand", 0);
    moveFaceUpSpell(ignitionSession, targetSpell, 1);
    ignitionSession.state.phase = "main1";
    ignitionSession.state.turnPlayer = 0;
    ignitionSession.state.waitingFor = 0;

    const ignitionHost = createLuaScriptHost(ignitionSession, workspace);
    expect(ignitionHost.loadCardScript(Number(pendragonCode), workspace).ok).toBe(true);
    expect(ignitionHost.registerInitialEffects()).toBe(1);
    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(ignitionSession), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignitionAction = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldPendragon.uid && action.effectId === "lua-2"
    );
    expect(ignitionAction, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignitionAction!);

    expect(restoredIgnition.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 905909026, returned: true },
    ]);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: fieldPendragon.uid,
      reasonEffectId: 2,
    });
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === targetSpell.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: fieldPendragon.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === fieldPendragon.uid)!, restoredIgnition.session.state)).toBe(3100);
    expect(restoredIgnition.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => ["discarded", "breakEffect", "destroyed", "sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discard.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: fieldPendragon.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: discard.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: fieldPendragon.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonCardUid: fieldPendragon.uid,
        eventReasonEffectId: 2,
        eventReasonPlayer: 0,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: targetSpell.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: fieldPendragon.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: targetSpell.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: fieldPendragon.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      { eventName: "chainSolved", eventCode: 1022, eventValue: 1, eventReasonPlayer: 0, eventPlayer: 0, eventChainDepth: 1, eventChainLinkId: "chain-3", relatedEffectId: 2 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: pendragonCode, name: "D/D/D Dragon King Pendragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 7, attack: 2600, defense: 2400 },
    { code: dragonReleaseCode, name: "Pendragon Dragon Release", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 4, attack: 1200, defense: 1000 },
    { code: fiendReleaseCode, name: "Pendragon Fiend Release", kind: "monster", typeFlags: typeMonster, race: raceFiend, level: 4, attack: 1200, defense: 1000 },
    { code: discardCode, name: "Pendragon Discard Cost", kind: "monster", typeFlags: typeMonster, race: raceFiend, level: 4, attack: 1000, defense: 1000 },
    { code: destroySpellCode, name: "Pendragon Destroy Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function releaseEvent(material: DuelCardInstance, source: DuelCardInstance, effectId: number, sequence: number) {
  return {
    eventName: "released",
    eventCode: 1017,
    eventCardUid: material.uid,
    eventReason: duelReason.cost | duelReason.release,
    eventReasonPlayer: 0,
    eventReasonCardUid: source.uid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence },
  };
}

function requireCard(session: DuelSession, code: string, owner?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (owner === undefined || candidate.owner === owner));
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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
