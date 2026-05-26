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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const reinforceCode = "71948047";
const hasReinforceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${reinforceCode}.lua`));
const rescueMonsterCode = "719480470";
const rescueSpellCode = "719480471";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const setRescueAce = 0x18c;

describe.skipIf(!hasUpstreamScripts || !hasReinforceScript)("Lua real script REINFORCE! stat protect grave set", () => {
  it("restores Rescue-ACE target stat protection and grave self-banish Set operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${reinforceCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_RESCUE_ACE),tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCode(EFFECT_IMMUNE_EFFECT)");
    expect(script).toContain("e4:SetCode(EFFECT_INDESTRUCTABLE_COUNT)");
    expect(script).toContain("e2:SetCategory(CATEGORY_LEAVE_GRAVE+CATEGORY_SET)");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("Duel.SelectTarget(tp,s.setfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SSet(tp,tc)");

    const cards: DuelCardData[] = [
      { code: reinforceCode, name: "REINFORCE!", kind: "trap", typeFlags: typeTrap, setcodes: [setRescueAce] },
      { code: rescueMonsterCode, name: "Rescue-ACE Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setRescueAce], level: 4, attack: 1800, defense: 1200 },
      { code: rescueSpellCode, name: "Rescue-ACE Spell Fixture", kind: "spell", typeFlags: typeSpell, setcodes: [setRescueAce] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 71948047, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [reinforceCode, rescueMonsterCode, rescueSpellCode] }, 1: { main: [] } });
    startDuel(session);

    const reinforce = requireCard(session, reinforceCode);
    const rescueMonster = requireCard(session, rescueMonsterCode);
    const rescueSpell = requireCard(session, rescueSpellCode);
    moveDuelCard(session.state, reinforce.uid, "spellTrapZone", 0).position = "faceDown";
    reinforce.faceUp = false;
    moveDuelCard(session.state, rescueMonster.uid, "monsterZone", 0).position = "faceUpAttack";
    rescueMonster.faceUp = true;
    moveDuelCard(session.state, rescueSpell.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(reinforceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === reinforce.uid && action.effectId === "lua-1-1002");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(activation).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === rescueMonster.uid), restoredOpen.session.state)).toBe(3300);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === rescueMonster.uid), restoredOpen.session.state)).toBe(2700);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === rescueMonster.uid && [1, 47].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
      valuePredicate: effect.valuePredicate ? true : undefined,
    }))).toEqual([
      { code: 1, controller: 0, event: "continuous", range: ["monsterZone"], sourceUid: rescueMonster.uid, value: undefined, valuePredicate: true },
      { code: 47, controller: 0, event: "continuous", range: ["monsterZone"], sourceUid: rescueMonster.uid, value: undefined, valuePredicate: true },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: rescueMonster.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);

    const restoredGrave = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const graveSet = getLuaRestoreLegalActions(restoredGrave, 0).find((action) => action.type === "activateEffect" && action.uid === reinforce.uid && action.effectId === "lua-2-1002");
    expect(graveSet, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredGrave, graveSet!);

    expect(restoredGrave.session.state.chain).toEqual([]);
    expect(restoredGrave.session.state.cards.find((card) => card.uid === reinforce.uid)).toMatchObject({ location: "banished", faceUp: true });
    expect(restoredGrave.session.state.cards.find((card) => card.uid === rescueSpell.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: false, position: "faceDown" });
    expect(restoredGrave.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === reinforce.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: reinforce.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
    ]);
    expect(restoredGrave.session.state.eventHistory.filter((event) => event.eventName === "becameTarget" && event.eventCardUid === rescueSpell.uid)).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: rescueSpell.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
      },
    ]);
    expect(restoredGrave.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === reinforce.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: reinforce.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: reinforce.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredGrave.session.state.eventHistory.filter((event) => event.eventName === "spellTrapSet" && event.eventCardUid === rescueSpell.uid)).toEqual([
      {
        eventName: "spellTrapSet",
        eventCode: 1107,
        eventCardUid: rescueSpell.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
