import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense, currentLevel } from "#duel/card-stats.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const otoshidamashiCode = "14957440";
const tokenCode = "14957441";
const opponentMonsterCode = "149574400";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOtoshidamashiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${otoshidamashiCode}.lua`));
const promptOverrides = [{ api: "AnnounceNumberRange" as const, player: 0 as const, returned: 1 }];
const counterOtoshidamashi = 0x59;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeNormal = 0x10;
const typeToken = 0x4000;
const raceBeast = 0x4000;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasOtoshidamashiScript)("Lua real script Otoshidamashi counter token stat", () => {
  it("restores opponent to-Grave trigger into AnnounceNumberRange token stat effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${otoshidamashiCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 14957440, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [otoshidamashiCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const otoshidamashi = requireCard(session, otoshidamashiCode);
    const opponent = requireCard(session, opponentMonsterCode);
    moveFaceUpAttack(session, otoshidamashi, 0);
    moveFaceUpAttack(session, opponent, 1);
    expect(addDuelCardCounter(otoshidamashi, counterOtoshidamashi, 1)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(otoshidamashiCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const send = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${opponentMonsterCode}),0,0,LOCATION_MZONE,nil)
      Debug.Message("otoshidamashi send " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "otoshidamashi-opponent-to-grave.lua",
    );
    expect(send.ok, send.error).toBe(true);
    expect(host.messages).toContain("otoshidamashi send 1");

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === otoshidamashi.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(getDuelCardCounter(findCard(restoredTrigger.session, otoshidamashi.uid), counterOtoshidamashi)).toBe(2);
    expect(restoredTrigger.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceNumberRange", player: 0, options: [1, 2], descriptions: [1, 2], returned: 1 },
    ]);
    const tokens = restoredTrigger.session.state.cards.filter((card) => card.code === tokenCode && card.location === "monsterZone");
    expect(tokens).toHaveLength(1);
    expect(tokens.map((token) => ({
      attack: currentAttack(token, restoredTrigger.session.state),
      defense: currentDefense(token, restoredTrigger.session.state),
      level: currentLevel(token, restoredTrigger.session.state),
      reason: token.reason,
      reasonCardUid: token.reasonCardUid,
      reasonEffectId: token.reasonEffectId,
    }))).toEqual([
      { attack: 1500, defense: 1500, level: 3, reason: duelReason.summon | duelReason.specialSummon, reasonCardUid: otoshidamashi.uid, reasonEffectId: 3 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["counterAdded", "breakEffect", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: otoshidamashi.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: otoshidamashi.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventReason: duelReason.effect, eventReasonCardUid: otoshidamashi.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: tokens[0]!.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: otoshidamashi.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: otoshidamashiCode, name: "Otoshidamashi", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 1, attack: 0, defense: 0 },
    { code: tokenCode, name: "Otoshidamashi Token", kind: "monster", typeFlags: typeMonster | typeNormal | typeToken, race: raceBeast, attribute: attributeEarth, level: 1, attack: 0, defense: 0 },
    { code: opponentMonsterCode, name: "Otoshidamashi Opponent Monster", kind: "monster", typeFlags: typeMonster, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("c:EnableCounterPermit(COUNTER_OTOSHIDAMASHI,LOCATION_MZONE)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)");
  expect(script).toContain("e1:SetValue(aux.imval2)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER+CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("c:AddCounter(COUNTER_OTOSHIDAMASHI,1)");
  expect(script).toContain("Duel.AnnounceNumberRange(tp,1,ct)");
  expect(script).toContain("local token=Duel.CreateToken(tp,id+1)");
  expect(script).toContain("Duel.SpecialSummonStep(token,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LEVEL)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_ATTACK)");
  expect(script).toContain("e3:SetCode(EFFECT_SET_DEFENSE)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
