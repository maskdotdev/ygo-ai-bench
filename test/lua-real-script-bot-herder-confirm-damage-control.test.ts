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
const botHerderCode = "45951104";
const ownedFacedownCode = "459511040";
const controlTargetCode = "459511041";
const controlDecoyCode = "459511042";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBotHerderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${botHerderCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;
const attributeDark = 0x20;
const categoryDamage = 0x80000;
const categoryControl = 0x2000;
const effectFlagCardTarget = 16;

describe.skipIf(!hasUpstreamScripts || !hasBotHerderScript)("Lua real script Bot Herder confirm damage control", () => {
  it("restores face-down confirmation into opponent damage and group control transfer", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${botHerderCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 45951104, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [botHerderCode, ownedFacedownCode] }, 1: { main: [controlTargetCode, controlDecoyCode] } });
    startDuel(session);

    const botHerder = requireCard(session, botHerderCode);
    const ownedFacedown = requireCard(session, ownedFacedownCode);
    const controlTarget = requireCard(session, controlTargetCode);
    const controlDecoy = requireCard(session, controlDecoyCode);
    moveDuelCard(session.state, botHerder.uid, "hand", 0);
    moveFaceDownDefense(session, ownedFacedown, 1, 0);
    ownedFacedown.owner = 0;
    moveFaceUpAttack(session, controlTarget, 1, 1);
    moveFaceUpAttack(session, controlDecoy, 1, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(botHerderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === botHerder.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryDamage | categoryControl, code: 1002, event: "ignition", property: effectFlagCardTarget, range: ["hand", "spellTrapZone"] },
    ]);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === botHerder.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    expect(restoredOpen.host.messages).toContain(`confirmed 0: ${ownedFacedownCode}`);
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(7800);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === botHerder.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownedFacedown.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      owner: 0,
      faceUp: false,
      position: "faceDownDefense",
    });
    for (const card of [controlTarget, controlDecoy]) {
      expect(restoredOpen.session.state.cards.find((candidate) => candidate.uid === card.uid)).toMatchObject({
        location: "monsterZone",
        controller: 0,
        previousController: 1,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: botHerder.uid,
        reasonEffectId: 1,
      });
    }
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "confirmed", "damageDealt", "controlChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: ownedFacedown.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: ownedFacedown.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [ownedFacedown.uid],
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 200,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: botHerder.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: controlTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: botHerder.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: controlDecoy.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: botHerder.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: controlTarget.uid,
        eventUids: [controlTarget.uid, controlDecoy.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: botHerder.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Bot Herder");
  expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE+CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("return (c:IsOwner(tp) and c:IsFaceup()) or c:IsPosition(POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.efftgfilter,tp,0,LOCATION_MZONE,1,1,nil,tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,200)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_CONTROL,nil,1,1-tp,LOCATION_MZONE)");
  expect(script).toContain("if tc:IsFacedown() then Duel.ConfirmCards(tp,tc) end");
  expect(script).toContain("Duel.Damage(1-tp,200,REASON_EFFECT)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,tc,true)");
  expect(script).toContain("Duel.GetControl(g,tp)");
}

function cards(): DuelCardData[] {
  return [
    { code: botHerderCode, name: "Bot Herder", kind: "spell", typeFlags: typeSpell },
    { code: ownedFacedownCode, name: "Bot Herder Owned Set Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1500, defense: 1500 },
    { code: controlTargetCode, name: "Bot Herder Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
    { code: controlDecoyCode, name: "Bot Herder Control Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDownDefense";
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
