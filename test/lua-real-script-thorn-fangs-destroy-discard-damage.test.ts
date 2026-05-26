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
const thornCode = "72374522";
const starvingVenomCode = "41209827";
const handDiscardCode = "723745220";
const opponentLowCode = "723745221";
const opponentHigherCode = "723745222";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasThornScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${thornCode}.lua`));
const promptOverrides = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasThornScript)("Lua real script Thorn Fangs destroy discard damage", () => {
  it("restores Starving Venom target into cannot-attack, lower-ATK destroy, whole-hand discard, and damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${thornCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 72374522, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [thornCode, handDiscardCode], extra: [starvingVenomCode] }, 1: { main: [opponentLowCode, opponentHigherCode] } });
    startDuel(session);

    const thorn = requireCard(session, thornCode);
    const starvingVenom = requireCard(session, starvingVenomCode);
    const handDiscard = requireCard(session, handDiscardCode);
    const opponentLow = requireCard(session, opponentLowCode);
    const opponentHigher = requireCard(session, opponentHigherCode);
    const setThorn = moveDuelCard(session.state, thorn.uid, "spellTrapZone", 0);
    setThorn.faceUp = false;
    setThorn.position = "faceDown";
    moveDuelCard(session.state, handDiscard.uid, "hand", 0);
    moveFaceUpAttack(session, starvingVenom, 0, 0);
    moveFaceUpAttack(session, opponentLow, 1, 0);
    moveFaceUpAttack(session, opponentHigher, 1, 1);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(thornCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, thorn.uid, "activateEffect"));
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.host.promptDecisions).toEqual([{ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1157992353, returned: true }]);
    expect(findCard(restoredOpen.session, thorn.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(findCard(restoredOpen.session, handDiscard.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.discard });
    expect(findCard(restoredOpen.session, opponentLow.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy });
    expect(findCard(restoredOpen.session, opponentHigher.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(6800);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === starvingVenom.uid && effect.code === 85).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
    }))).toEqual([{ code: 85, event: "continuous", property: 0x400 | 0x4000000, reset: { flags: 1107169792 } }]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentLow.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: thorn.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentLow.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: thorn.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: handDiscard.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: thorn.uid, eventReasonEffectId: 1, previous: "hand", current: "graveyard" },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 1200, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: thorn.uid, eventReasonEffectId: 1, previous: undefined, current: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: thorn.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const thorn = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === thornCode);
  const starvingVenom = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === starvingVenomCode);
  expect(thorn).toBeDefined();
  expect(starvingVenom).toBeDefined();
  return [
    thorn!,
    starvingVenom!,
    monster(handDiscardCode, "Thorn Fangs Hand Discard", 900),
    monster(opponentLowCode, "Thorn Fangs Lower ATK Target", 1200),
    monster(opponentHigherCode, "Thorn Fangs Higher ATK Survivor", 3000),
  ];
}

function monster(code: string, name: string, attack: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack, defense: 1000 };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Thorn Fangs of Violet Poison");
  expect(script).toContain("CARD_STARVING_VENOM_FUSION_DRAGON=41209827");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_HANDES+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsAttackBelow,tc:GetAttack()-1),tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
  expect(script).toContain("Duel.GetOperatedGroup():Match(aux.NOT(Card.IsTextAttack),nil,-2):GetSum(Card.GetTextAttack)");
  expect(script).toContain("Duel.SendtoGrave(hg,REASON_EFFECT|REASON_DISCARD)");
  expect(script).toContain("Duel.Damage(1-tp,dam,REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  if (card.code === starvingVenomCode) moved.summonType = "fusion";
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

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventUids?: string[];
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventUids: event.eventUids,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
  };
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
