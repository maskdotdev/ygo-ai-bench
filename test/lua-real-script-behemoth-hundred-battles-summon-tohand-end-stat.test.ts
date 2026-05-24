import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const behemothCode = "13836592";
const tributeCode = "138365920";
const beastTargetCode = "138365921";
const specialBeastTargetCode = "138365922";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBehemothScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${behemothCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectImmuneEffect = 1;
const phaseEndCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasBehemothScript)("Lua real script Behemoth Hundred Battles summon to-hand end stat", () => {
  it("restores one-tribute summon search ATK drop, Special Summon search, normal immunity, and End Phase ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectBehemothScriptShape(workspace.readScript(`official/c${behemothCode}.lua`));
    const reader = createCardReader(cards());

    const normal = createRestoredNormalSummonSearch({ reader, workspace });
    expectCleanRestore(normal);
    expectRestoredLegalActions(normal, 0);
    const normalBehemoth = requireCard(normal.session, behemothCode);
    const tribute = requireCard(normal.session, tributeCode);
    const beastTarget = requireCard(normal.session, beastTargetCode);
    expect(normal.session.state.effects.filter((effect) => effect.sourceUid === normalBehemoth.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerCode: effect.triggerCode,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: 32, event: "continuous", id: "lua-1-32", property: 263168, range: ["hand"], triggerCode: undefined, triggerEvent: undefined },
      { code: 36, event: "continuous", id: "lua-2-36", property: 263168, range: ["hand"], triggerCode: undefined, triggerEvent: undefined },
      { code: 1100, event: "trigger", id: "lua-3-1100", property: 65552, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerCode: 1100, triggerEvent: "normalSummoned" },
      { code: 1102, event: "trigger", id: "lua-4-1102", property: 65552, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerCode: 1102, triggerEvent: "specialSummoned" },
      { code: effectImmuneEffect, event: "continuous", id: "lua-5-1", property: 131072, range: ["monsterZone"], triggerCode: undefined, triggerEvent: undefined },
      { code: phaseEndCode, event: "trigger", id: "lua-6-4608", property: undefined, range: ["monsterZone"], triggerCode: phaseEndCode, triggerEvent: "phaseEnd" },
    ]);
    const tributeSummon = getLuaRestoreLegalActions(normal, 0).find((action) =>
      action.type === "tributeSummon" && action.uid === normalBehemoth.uid && action.effectId === "lua-1-32" && action.tributeUids.length === 0
    );
    expect(tributeSummon, JSON.stringify(getLuaRestoreLegalActions(normal, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(normal, tributeSummon!);

    const normalTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(normal.session), workspace, reader);
    expectCleanRestore(normalTriggerWindow);
    expectRestoredLegalActions(normalTriggerWindow, 0);
    expect(normalTriggerWindow.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1100", eventCode: 1100, eventName: "normalSummoned", player: 0, sourceUid: normalBehemoth.uid, triggerBucket: "turnOptional" },
    ]);
    const normalSearch = getLuaRestoreLegalActions(normalTriggerWindow, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === normalBehemoth.uid && action.effectId === "lua-3-1100"
    );
    expect(normalSearch, JSON.stringify(getLuaRestoreLegalActions(normalTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(normalTriggerWindow, normalSearch!);
    resolveRestoredChain(normalTriggerWindow);

    expect(normalTriggerWindow.session.state.cards.find((card) => card.uid === tribute.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.material | duelReason.summon,
      reasonPlayer: 0,
      reasonCardUid: normalBehemoth.uid,
      reasonEffectId: 1,
    });
    expect(normalTriggerWindow.session.state.cards.find((card) => card.uid === beastTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: normalBehemoth.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(normalTriggerWindow.session.state.cards.find((card) => card.uid === normalBehemoth.uid), normalTriggerWindow.session.state)).toBe(2000);
    expect(normalTriggerWindow.session.state.cards.find((card) => card.uid === normalBehemoth.uid)).toMatchObject({
      attackModifier: -700,
    });
    expect(normalTriggerWindow.host.messages).toContain(`confirmed 1: ${beastTargetCode}`);
    expect(normalTriggerWindow.session.state.eventHistory.filter((event) =>
      ["released", "normalSummoned", "becameTarget", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: tribute.uid, eventCode: 1017, eventName: "released", eventPlayer: undefined, eventReason: duelReason.release | duelReason.material | duelReason.summon, eventReasonCardUid: normalBehemoth.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: normalBehemoth.uid, eventCode: 1100, eventName: "normalSummoned", eventPlayer: undefined, eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: beastTarget.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 3 },
      { eventCardUid: beastTarget.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: normalBehemoth.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: beastTarget.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: normalBehemoth.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: beastTarget.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: normalBehemoth.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);

    normalTriggerWindow.session.state.phase = "main2";
    normalTriggerWindow.session.state.waitingFor = 0;
    const restoredMain2 = restoreDuelWithLuaScripts(serializeDuel(normalTriggerWindow.session), workspace, reader);
    expectCleanRestore(restoredMain2);
    expectRestoredLegalActions(restoredMain2, 0);
    const endPhase = getLuaRestoreLegalActions(restoredMain2, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredMain2, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMain2, endPhase!);
    const endTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredMain2.session), workspace, reader);
    expectCleanRestore(endTriggerWindow);
    expectRestoredLegalActions(endTriggerWindow, 0);
    expect(endTriggerWindow.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-6-4608", eventCode: phaseEndCode, eventName: "phaseEnd", player: 0, sourceUid: normalBehemoth.uid, triggerBucket: "turnOptional" },
    ]);
    const endBoost = getLuaRestoreLegalActions(endTriggerWindow, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === normalBehemoth.uid && action.effectId === "lua-6-4608"
    );
    expect(endBoost, JSON.stringify(getLuaRestoreLegalActions(endTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(endTriggerWindow, endBoost!);
    resolveRestoredChain(endTriggerWindow);
    expect(currentAttack(endTriggerWindow.session.state.cards.find((card) => card.uid === normalBehemoth.uid), endTriggerWindow.session.state)).toBe(2700);
    expect(endTriggerWindow.session.state.cards.find((card) => card.uid === normalBehemoth.uid)?.attackModifier).toBe(0);
    expect(endTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd").map((event) => ({
      eventCode: event.eventCode,
      eventName: event.eventName,
    }))).toEqual([{ eventCode: phaseEndCode, eventName: "phaseEnd" }]);
    expect(endTriggerWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const special = createRestoredSpecialSummonSearch({ reader, workspace });
    expectCleanRestore(special);
    expectRestoredLegalActions(special, 0);
    const specialBehemoth = requireCard(special.session, behemothCode);
    const specialTarget = requireCard(special.session, specialBeastTargetCode);
    expect(special.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1102", eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: specialBehemoth.uid, triggerBucket: "turnOptional" },
    ]);
    const specialSearch = getLuaRestoreLegalActions(special, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === specialBehemoth.uid && action.effectId === "lua-4-1102"
    );
    expect(specialSearch, JSON.stringify(getLuaRestoreLegalActions(special, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(special, specialSearch!);
    resolveRestoredChain(special);
    expect(special.session.state.cards.find((card) => card.uid === specialTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: specialBehemoth.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(special.session.state.cards.find((card) => card.uid === specialBehemoth.uid), special.session.state)).toBe(2000);
  });
});

function createRestoredNormalSummonSearch({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 13836592, reader, workspace, main: [behemothCode, tributeCode, beastTargetCode] });
  moveDuelCard(session.state, requireCard(session, behemothCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, tributeCode), 0, 0);
  moveFaceUpGrave(session, requireCard(session, beastTargetCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredSpecialSummonSearch({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 13836593, reader, workspace, main: [behemothCode, specialBeastTargetCode] });
  const behemoth = requireCard(session, behemothCode);
  moveDuelCard(session.state, behemoth.uid, "hand", 0);
  moveFaceUpGrave(session, requireCard(session, specialBeastTargetCode), 0, 0);
  specialSummonDuelCard(session.state, behemoth.uid, 0, 0, {}, undefined, true, true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createBaseSession({
  seed,
  reader,
  workspace,
  main,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  main: string[];
}): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main }, 1: { main: [] } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(behemothCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function cards(): DuelCardData[] {
  return [
    { code: behemothCode, name: "Behemoth the King of a Hundred Battles", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 10, attack: 2700, defense: 1500 },
    { code: tributeCode, name: "Behemoth Tribute", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: beastTargetCode, name: "Behemoth Beast Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
    { code: specialBeastTargetCode, name: "Behemoth Special Beast Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function expectBehemothScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Behemoth the King of a Hundred Battles");
  expect(script).toContain("aux.AddNormalSummonProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,aux.Stringid(id,0))");
  expect(script).toContain("aux.AddNormalSetProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,aux.Stringid(id,0))");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsRace(RACES_BEAST_BWARRIOR_WINGB) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,-700)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");
  expect(script).toContain("c:UpdateAttack(-700)");
  expect(script).toContain("e4:SetCode(EFFECT_IMMUNE_EFFECT)");
  expect(script).toContain("e4:SetCondition(function(e) return e:GetHandler():IsNormalSummoned() end)");
  expect(script).toContain("te:IsMonsterEffect() and te:IsActivated() and te:GetHandler():IsSpecialSummoned()");
  expect(script).toContain("e5:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("return Duel.IsTurnPlayer(tp)");
  expect(script).toContain("c:UpdateAttack(700)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
  moved.sequence = sequence;
  moved.faceUp = true;
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
