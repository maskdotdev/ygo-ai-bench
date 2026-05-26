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
const rhythmCode = "4582942";
const vaalmonicaLinkCode = "45829420";
const ownSpellTrapCode = "45829421";
const opponentBounceCode = "45829422";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasRhythmScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rhythmCode}.lua`));
const promptOverrides = [
  { api: "SelectEffect" as const, player: 0 as const, returned: 3 },
  { api: "SelectYesNo" as const, player: 0 as const, returned: true },
  { api: "SelectYesNo" as const, player: 0 as const, returned: true },
];
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceFairy = 0x4;
const attributeLight = 0x10;
const setVaalmonica = 0x19c;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasRhythmScript)("Lua real script Vaalmonica Followed Rhythm select both", () => {
  it("restores SelectEffect both branch into recover-destroy, damage-bounce, and prompt decisions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${rhythmCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 4582942, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rhythmCode, ownSpellTrapCode], extra: [vaalmonicaLinkCode] }, 1: { main: [opponentBounceCode] } });
    startDuel(session);

    const rhythm = requireCard(session, rhythmCode);
    const vaalmonicaLink = requireCard(session, vaalmonicaLinkCode);
    const ownSpellTrap = requireCard(session, ownSpellTrapCode);
    const opponentBounce = requireCard(session, opponentBounceCode);
    const setRhythm = moveDuelCard(session.state, rhythm.uid, "spellTrapZone", 0);
    setRhythm.faceUp = false;
    setRhythm.position = "faceDown";
    moveFaceUpAttack(session, vaalmonicaLink, 0, 0);
    moveDuelCard(session.state, ownSpellTrap.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(session, opponentBounce, 1, 0);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(rhythmCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, rhythm.uid, "activateEffect"));
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.host.promptDecisions.map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
      options: "options" in prompt ? prompt.options : undefined,
    }))).toEqual([
      { api: "SelectEffect", player: 0, returned: 3, options: [1, 2, 3] },
      { api: "SelectYesNo", player: 0, returned: true, options: undefined },
      { api: "SelectYesNo", player: 0, returned: true, options: undefined },
    ]);
    expect(findCard(restoredOpen.session, rhythm.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(findCard(restoredOpen.session, ownSpellTrap.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.destroy });
    expect(findCard(restoredOpen.session, vaalmonicaLink.uid)).toMatchObject({ location: "hand", controller: 0, reason: duelReason.effect });
    expect(findCard(restoredOpen.session, opponentBounce.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["recoveredLifePoints", "destroyed", "sentToGraveyard", "damageDealt", "sentToHand"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "recoveredLifePoints", eventCode: 1112, eventCardUid: undefined, eventPlayer: 0, eventValue: 500, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: rhythm.uid, eventReasonEffectId: 1, previous: undefined, current: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: ownSpellTrap.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: rhythm.uid, eventReasonEffectId: 1, previous: "spellTrapZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: ownSpellTrap.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: rhythm.uid, eventReasonEffectId: 1, previous: "spellTrapZone", current: "graveyard" },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 0, eventValue: 500, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: rhythm.uid, eventReasonEffectId: 1, previous: undefined, current: undefined },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: vaalmonicaLink.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: rhythm.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "hand" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: rhythm.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const rhythm = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === rhythmCode);
  expect(rhythm).toBeDefined();
  return [
    rhythm!,
    { code: vaalmonicaLinkCode, name: "Followed Rhythm Vaalmonica Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceFairy, attribute: attributeLight, level: 1, attack: 1200, defense: 0, linkMarkers: 0x20, setcodes: [setVaalmonica] },
    { code: ownSpellTrapCode, name: "Followed Rhythm Destroy Target", kind: "trap", typeFlags: typeTrap, setcodes: [setVaalmonica] },
    { code: opponentBounceCode, name: "Followed Rhythm Bounce Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Vaalmonica Followed Rhythm");
  expect(script).toContain("e1:SetCategory(CATEGORY_RECOVER+CATEGORY_DESTROY+CATEGORY_DAMAGE+CATEGORY_TOHAND)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("return c:IsSetCard(SET_VAALMONICA) and c:IsFaceup() and c:IsOriginalType(TYPE_MONSTER)");
  expect(script).toContain("return c:IsSetCard(SET_VAALMONICA) and c:IsFaceup() and c:IsLinkMonster()");
  expect(script).toContain("op=Duel.SelectEffect(tp,");
  expect(script).toContain("{both,aux.Stringid(id,3)}");
  expect(script).toContain("Duel.Recover(tp,500,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,4))");
  expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
  expect(script).toContain("Duel.Damage(tp,500,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,5))");
  expect(script).toContain("Duel.SendtoHand(hg,nil,REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  if (card.code === vaalmonicaLinkCode) moved.summonType = "link";
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
