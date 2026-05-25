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
const redemptionCode = "65853758";
const ownYummyCode = "658537580";
const opponentCode = "658537581";
const lightBeastCode = "658537582";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRedemptionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${redemptionCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const typeEffect = 0x20;
const attributeLight = 0x10;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const setYummy = 0x1c1;
const effectFlagCardTarget = 0x10;
const effectFlagDelay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasRedemptionScript)("Lua real script Yummy Redemption grave swap control", () => {
  it("restores grave SelfBanish SelectUnselectGroup targets into SwapControl and field ATK reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${redemptionCode}.lua`);
    expect(script).toContain("--Yummy★Redemption");
    expect(script).toContain("e0:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("return -200*Duel.GetMatchingGroupCount(s.atkvalfilter,e:GetHandlerPlayer(),LOCATION_MZONE|LOCATION_GRAVE,0,nil)");
    expect(script).toContain("e2:SetCategory(CATEGORY_DRAW+CATEGORY_TODECK)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKBOTTOM,REASON_EFFECT)");
    expect(script).toContain("e3:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
    expect(script).toContain("aux.SelectUnselectGroup(g1,e,tp,2,2,aux.dpcheck(Card.GetControler),1,tp,HINTMSG_CONTROL)");
    expect(script).toContain("Duel.SetTargetCard(tg)");
    expect(script).toContain("Duel.GetTargetCards(e)");
    expect(script).toContain("Duel.SwapControl(tg:GetFirst(),tg:GetNext())");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 65853758, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [redemptionCode, ownYummyCode, lightBeastCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const redemption = requireCard(session, redemptionCode);
    const ownYummy = requireCard(session, ownYummyCode);
    const opponent = requireCard(session, opponentCode);
    const lightBeast = requireCard(session, lightBeastCode);
    moveDuelCard(session.state, redemption.uid, "graveyard", 0);
    moveFaceUpAttack(session, ownYummy, 0, 0);
    moveFaceUpAttack(session, opponent, 1, 0);
    moveDuelCard(session.state, lightBeast.uid, "graveyard", 0);
    lightBeast.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(redemptionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === redemption.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      {
        category: undefined,
        code: 1002,
        countLimit: undefined,
        event: "ignition",
        property: 16384,
        range: ["hand", "spellTrapZone"],
        targetRange: undefined,
        triggerEvent: undefined,
      },
      {
        category: undefined,
        code: 100,
        countLimit: undefined,
        event: "continuous",
        property: undefined,
        range: ["spellTrapZone"],
        targetRange: [0, 4],
        triggerEvent: undefined,
      },
      {
        category: 65552,
        code: 1102,
        countLimit: 1,
        event: "trigger",
        property: effectFlagDelay,
        range: ["spellTrapZone"],
        targetRange: undefined,
        triggerEvent: "specialSummoned",
      },
      {
        category: 8192,
        code: 1002,
        countLimit: 1,
        event: "quick",
        property: effectFlagCardTarget,
        range: ["graveyard"],
        targetRange: undefined,
        triggerEvent: undefined,
      },
    ]);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === redemption.uid && action.effectId === "lua-4-1002"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, activation!);
    expect(findCard(restoredOpen.session, redemption.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: redemption.uid,
      reasonEffectId: 4,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? 0);
    passRestoredChain(restoredChain);

    expect(findCard(restoredChain.session, ownYummy.uid)).toMatchObject({
      controller: 1,
      previousController: 0,
      location: "monsterZone",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: redemption.uid,
      reasonEffectId: 4,
    });
    expect(findCard(restoredChain.session, opponent.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: redemption.uid,
      reasonEffectId: 4,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["banished", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: redemption.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: redemption.uid, eventReasonEffectId: 4, previousController: 0, currentController: 0 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: ownYummy.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousController: 0, currentController: 0 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponent.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousController: 1, currentController: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: ownYummy.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: redemption.uid, eventReasonEffectId: 4, previousController: 0, currentController: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: opponent.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: redemption.uid, eventReasonEffectId: 4, previousController: 1, currentController: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: ownYummy.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: redemption.uid, eventReasonEffectId: 4, previousController: 0, currentController: 1 },
    ]);

    const restoredSwapped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), workspace, reader);
    expectCleanRestore(restoredSwapped);
    expectRestoredLegalActions(restoredSwapped, restoredSwapped.session.state.waitingFor ?? restoredSwapped.session.state.turnPlayer);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: redemptionCode, name: "Yummy Redemption", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: ownYummyCode, name: "Yummy Redemption Own Yummy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setYummy], race: raceBeast, attribute: attributeLight, level: 1, attack: 1000, defense: 1000 },
    { code: opponentCode, name: "Yummy Redemption Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1200 },
    { code: lightBeastCode, name: "Yummy Redemption Grave Beast", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeLight, level: 1, attack: 500, defense: 500 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
