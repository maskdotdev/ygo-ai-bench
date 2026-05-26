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
const masqueradeCode = "2061963";
const opponentMillCode = "20619630";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMasqueradeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${masqueradeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasMasqueradeScript)("Lua real script Number 104 Masquerade deck mill", () => {
  it("restores the official ignition target-player Deck mill branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${masqueradeCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 2061963, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [masqueradeCode] }, 1: { main: [opponentMillCode] } });
    startDuel(session);
    const masquerade = requireCard(session, masqueradeCode);
    const opponentMill = requireCard(session, opponentMillCode);
    moveFaceUpAttack(session, masquerade, 0);
    masquerade.summonType = "xyz";
    masquerade.summonTypeCode = 0x49000000;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(masqueradeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === masquerade.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", id: "lua-1-31", property: 0x40400, range: ["monsterZone"] },
      { category: 268959744, code: 1027, countLimit: undefined, event: "quick", id: "lua-2-1027", property: 0xc000, range: ["monsterZone"] },
      { category: 0x40, code: undefined, countLimit: 1, event: "ignition", id: "lua-3", property: undefined, range: ["monsterZone"] },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === masquerade.uid && action.effectId === "lua-3");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(findCard(restoredOpen.session, opponentMill.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: masquerade.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentMill.uid, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: masquerade.uid, eventReasonEffectId: 3, previous: "deck", current: "graveyard" },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(findCard(restoredAfter.session, opponentMill.uid)).toMatchObject({ location: "graveyard", reasonCardUid: masquerade.uid });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const masquerade = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === masqueradeCode);
  expect(masquerade).toBeDefined();
  return [
    masquerade ?? { code: masqueradeCode, name: "Number 104: Masquerade", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 2700, defense: 1200 },
    { code: opponentMillCode, name: "Masquerade Opponent Mill", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Number 104: Masquerade");
  expect(script).toContain("Xyz.AddProcedure(c,nil,4,3)");
  expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("Duel.IsBattlePhase() and re:IsMonsterEffect() and Duel.IsChainNegatable(ev)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.Damage(1-tp,800,REASON_EFFECT)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DECKDES)");
  expect(script).toContain("Duel.IsPlayerCanDiscardDeck(1-tp,1)");
  expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
  expect(script).toContain("Duel.SetTargetParam(1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,1-tp,1)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.DiscardDeck(p,d,REASON_EFFECT)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
