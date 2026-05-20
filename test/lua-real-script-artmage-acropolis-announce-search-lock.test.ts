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
const acropolisCode = "74733322";
const announcedArtmageCode = "747333220";
const otherArtmageCode = "747333221";
const faceupArtmageCode = "747333222";
const discardSpellCode = "747333223";
const offArchetypeCode = "747333224";
const mediusCode = "97556336";
const setArtmage = 0x1c7;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeField = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Artmage Acropolis announce search lock", () => {
  it("restores discard cost, dynamic announce Deck search, player flag, and non-Artmage summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${acropolisCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_EXTRA_SUMMON_COUNT)");
    expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsCode,CARD_MEDIUS_THE_PURE))");
    expect(script).toContain("e2:SetCost(Cost.Discard(Card.IsSpellTrap))");
    expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_ARTMAGE),tp,LOCATION_MZONE,0,nil):GetClass(Card.GetCode)");
    expect(script).toContain("table.insert(s.declared_names[tp],ac)");
    expect(script).toContain("Duel.SetTargetParam(ac)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil,code)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("return not (c:IsSetCard(SET_ARTMAGE) or c:IsCode(CARD_MEDIUS_THE_PURE) or c:IsLocation(LOCATION_EXTRA))");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === acropolisCode),
      { code: announcedArtmageCode, name: "Acropolis Announced Artmage", kind: "monster", typeFlags: typeMonster, setcodes: [setArtmage], level: 4, attack: 1500, defense: 1000 },
      { code: otherArtmageCode, name: "Acropolis Other Artmage", kind: "monster", typeFlags: typeMonster, setcodes: [setArtmage], level: 4, attack: 1600, defense: 1000 },
      { code: faceupArtmageCode, name: "Acropolis Faceup Artmage", kind: "monster", typeFlags: typeMonster, setcodes: [setArtmage], level: 4, attack: 1700, defense: 1000 },
      { code: discardSpellCode, name: "Acropolis Discard Spell", kind: "spell", typeFlags: typeSpell, attack: 0, defense: 0 },
      { code: offArchetypeCode, name: "Acropolis Off-Archetype Probe", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
      { code: mediusCode, name: "Medius the Pure", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 74733322, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [acropolisCode, discardSpellCode, faceupArtmageCode, announcedArtmageCode, otherArtmageCode, offArchetypeCode, mediusCode] },
      1: { main: [] },
    });
    startDuel(session);

    const acropolis = requireCard(session, acropolisCode);
    const discardSpell = requireCard(session, discardSpellCode);
    const faceupArtmage = requireCard(session, faceupArtmageCode);
    const announcedArtmage = requireCard(session, announcedArtmageCode);
    const otherArtmage = requireCard(session, otherArtmageCode);
    const offArchetype = requireCard(session, offArchetypeCode);
    const medius = requireCard(session, mediusCode);
    moveFaceUpFieldSpell(session, acropolis.uid, 0);
    moveDuelCard(session.state, discardSpell.uid, "hand", 0);
    moveFaceUpMonster(session, faceupArtmage.uid, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(acropolisCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).not.toContain("unsupported");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === acropolis.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      value: effect.value,
    }))).toEqual([
      { code: 1002, event: "ignition", range: ["hand", "spellTrapZone"], targetRange: undefined, luaTargetDescriptor: undefined, value: undefined },
      { code: 29, event: "continuous", range: ["spellTrapZone"], targetRange: [6, 0], luaTargetDescriptor: `target:code:${mediusCode}`, value: undefined },
      { code: undefined, event: "ignition", range: ["spellTrapZone"], targetRange: undefined, luaTargetDescriptor: undefined, value: undefined },
      { code: 1210, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined, luaTargetDescriptor: undefined, value: undefined },
    ]);

    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === acropolis.uid && action.effectId === "lua-3");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);

    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [Number(otherArtmageCode), Number(announcedArtmageCode)], descriptions: [Number(otherArtmageCode), Number(announcedArtmageCode)], returned: Number(otherArtmageCode) },
    ]);
    expect(restored.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === discardSpell.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: acropolis.uid,
      reasonEffectId: 3,
    });
    expect(restored.session.state.cards.find((card) => card.uid === otherArtmage.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: acropolis.uid,
      reasonEffectId: 3,
    });
    expect(restored.session.state.cards.find((card) => card.uid === announcedArtmage.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === faceupArtmage.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === offArchetype.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === medius.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === acropolis.uid && effect.code === 22).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      targetRange: effect.targetRange,
      luaTargetDescriptor: effect.luaTargetDescriptor,
    }))).toEqual([
      {
        code: 22,
        event: "continuous",
        reset: { flags: 1073742336 },
        targetRange: [1, 0],
        luaTargetDescriptor: "special-summon-limit:not-setcode-code-or-extra:455:97556336",
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["discarded", "sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discardSpell.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: acropolis.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: discardSpell.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: acropolis.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: otherArtmage.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: acropolis.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: otherArtmage.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [otherArtmage.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: acropolis.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: otherArtmage.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [otherArtmage.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: acropolis.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function moveFaceUpFieldSpell(session: DuelSession, uid: string, controller: PlayerId): DuelCardInstance {
  const card = moveDuelCard(session.state, uid, "spellTrapZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
  card.data.typeFlags = (card.data.typeFlags ?? 0) | typeSpell | typeField;
  return card;
}

function moveFaceUpMonster(session: DuelSession, uid: string, controller: PlayerId): DuelCardInstance {
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
