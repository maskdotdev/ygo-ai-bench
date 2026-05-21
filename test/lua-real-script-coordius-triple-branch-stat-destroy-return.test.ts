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
const coordiusCode = "70219023";
const graveSpellCode = "702190230";
const ownDecoyCode = "702190234";
const opponentCodes = ["702190231", "702190232", "702190233"] as const;
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCoordiusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${coordiusCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceFiend = 0x8;
const attributeDark = 0x10;
const summonTypeFusion = 0x43000000;

describe.skipIf(!hasUpstreamScripts || !hasCoordiusScript)("Lua real script Coordius triple branch stat destroy return", () => {
  it("restores AnnounceNumber LP cost into all option branches, ATK gain, and attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${coordiusCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,s.fusfilter(TYPE_SYNCHRO),s.fusfilter(TYPE_XYZ),s.fusfilter(TYPE_LINK))");
    expect(script).toContain("Duel.AnnounceNumber(tp,table.unpack(t))");
    expect(script).toContain("Duel.PayLPCost(tp,cost)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_GRAVE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,nil,3,1-tp,LOCATION_ONFIELD)");
    expect(script).toContain("Duel.SelectOption(tp,table.unpack(desctable))");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,0,LOCATION_ONFIELD,3,3,nil)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("Duel.RegisterEffect(e2,tp)");
    expect(script).toContain("aux.RegisterClientHint");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 70219023, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [graveSpellCode, ownDecoyCode], extra: [coordiusCode] }, 1: { main: [...opponentCodes] } });
    startDuel(session);
    const coordius = requireCard(session, coordiusCode);
    const graveSpell = requireCard(session, graveSpellCode);
    const ownDecoy = requireCard(session, ownDecoyCode);
    const opponentCards = opponentCodes.map((code) => requireCard(session, code));
    moveFaceUpAttack(session, coordius, 0);
    coordius.summonType = "fusion";
    coordius.summonTypeCode = summonTypeFusion;
    moveDuelCard(session.state, graveSpell.uid, "graveyard", 0);
    moveFaceUpAttack(session, ownDecoy, 0);
    for (const opponentCard of opponentCards) moveFaceUpAttack(session, opponentCard, 1);
    session.state.players[1].lifePoints = 6000;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(coordiusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: [{ api: "AnnounceNumber", player: 0, returned: 6000 }] });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === coordius.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(activation)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restored, activation!);
    passRestoredChain(restored);

    expect(restored.session.state.players[0].lifePoints).toBe(2000);
    expect(restored.host.promptDecisions.map((decision) => ({
      api: decision.api,
      player: decision.player,
      options: "options" in decision ? decision.options : undefined,
      returned: decision.returned,
    }))).toEqual([
      { api: "AnnounceNumber", player: 0, options: [2000, 4000, 6000], returned: 6000 },
      { api: "SelectOption", player: 0, options: [0, 1, 2], returned: 0 },
      { api: "SelectOption", player: 0, options: [0, 1], returned: 0 },
      { api: "SelectOption", player: 0, options: [0], returned: 0 },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === graveSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: coordius.uid,
      reasonEffectId: 2,
    });
    for (const opponentCard of opponentCards) {
      expect(restored.session.state.cards.find((card) => card.uid === opponentCard.uid)).toMatchObject({
        location: "graveyard",
        controller: 1,
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: coordius.uid,
        reasonEffectId: 2,
      });
    }
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === coordius.uid), restored.session.state)).toBe(5000);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === coordius.uid).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      reset: effect.reset,
      value: effect.value,
    }))).toContainEqual({
      sourceUid: coordius.uid,
      code: 100,
      event: "continuous",
      range: ["monsterZone"],
      targetRange: undefined,
      reset: { flags: 1107169792 },
      value: 2000,
    });
    expect(restored.session.state.effects.filter((effect) => effect.code === 85).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      reset: effect.reset,
    }))).toEqual([
      { sourceUid: coordius.uid, code: 85, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: [4, 0], reset: { flags: 1073742336 } },
    ]);
    const relevantEvents = restored.session.state.eventHistory.filter((event) => ["lifePointCostPaid", "sentToHand", "confirmed", "destroyed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }));
    expect(relevantEvents).toEqual([
      { eventName: "lifePointCostPaid", eventCode: 1201, eventCardUid: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: coordius.uid, eventReasonEffectId: 2, previousLocation: undefined, currentLocation: undefined },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: graveSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: coordius.uid, eventReasonEffectId: 2, previousLocation: "graveyard", currentLocation: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: graveSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: coordius.uid, eventReasonEffectId: 2, previousLocation: "graveyard", currentLocation: "hand" },
      ...opponentCards.flatMap((opponentCard) => [
        { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentCard.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: coordius.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
        { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentCard.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: coordius.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
      ]),
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentCards[0]!.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: coordius.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: coordiusCode, name: "Coordius the Triphasic Dealmon", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceFiend, attribute: attributeDark, level: 9, attack: 3000, defense: 3000 },
    { code: graveSpellCode, name: "Coordius Grave Spell", kind: "spell", typeFlags: typeSpell },
    { code: ownDecoyCode, name: "Coordius Attack Locked Decoy", kind: "monster", typeFlags: typeMonster, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    ...opponentCodes.map((code, index) => ({ code, name: `Coordius Destroy Target ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 })),
  ];
}

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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
