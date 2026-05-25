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
const seleglareCode = "29303524";
const opponentMonsterCode = "293035240";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSeleglareScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${seleglareCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const categoryToHand = 0x8;
const categoryControl = 0x2000;
const eventFreeChain = 1002;
const effectSetProc = 36;
const effectSetBaseAttack = 103;
const effectFlagCardTarget = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasSeleglareScript)("Lua real script Seleglare no-tribute control", () => {
  it("restores no-tribute summon procedure into base ATK change and Quick Effect control take", () => {
    const { workspace, reader, session } = createFixture(29303524);
    expectScriptShape(workspace.readScript(`official/c${seleglareCode}.lua`));
    const seleglare = requireCard(session, seleglareCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    moveDuelCard(session.state, seleglare.uid, "hand", 0);
    moveFaceUpAttack(session, opponentMonster, 1, 0);
    prepareMainPhase(session);
    registerSeleglare(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === seleglare.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 32, countLimit: undefined, event: "continuous", id: "lua-1-32", property: undefined, range: ["hand"] },
      { category: undefined, code: effectSetProc, countLimit: undefined, event: "continuous", id: `lua-2-${effectSetProc}`, property: undefined, range: ["hand"] },
      { category: categoryToHand | categoryControl, code: eventFreeChain, countLimit: 1, event: "quick", id: `lua-3-${eventFreeChain}`, property: effectFlagCardTarget, range: ["monsterZone"] },
    ]);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "tributeSummon" && action.uid === seleglare.uid && action.effectId === "lua-1-32"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);

    expect(findCard(restoredOpen.session, seleglare.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "normal",
      summonTypeCode: 0x10000000,
      reason: duelReason.summon,
    });
    expect(currentAttack(findCard(restoredOpen.session, seleglare.uid), restoredOpen.session.state)).toBe(1500);
    expect(restoredOpen.session.state.effects.some((effect) =>
      effect.sourceUid === seleglare.uid && effect.code === effectSetBaseAttack && effect.event === "continuous" && effect.value === 1500
    )).toBe(true);

    const restoredControl = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredControl);
    expectRestoredLegalActions(restoredControl, 0);
    const control = getLuaRestoreLegalActions(restoredControl, 0).find((action) =>
      action.type === "activateEffect" && action.uid === seleglare.uid && action.effectId === `lua-3-${eventFreeChain}`
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredControl, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredControl, control!);
    resolveRestoredChain(restoredControl);

    expect(findCard(restoredControl.session, seleglare.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: seleglare.uid,
      reasonEffectId: 3,
    });
    expect(findCard(restoredControl.session, opponentMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: seleglare.uid,
      reasonEffectId: 3,
    });
    expect(restoredControl.session.state.eventHistory.filter((event) => ["sentToHand", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "sentToHand", eventCardUid: seleglare.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: seleglare.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "hand", previousController: 0, currentController: 0 },
      { eventName: "controlChanged", eventCardUid: opponentMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: seleglare.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "monsterZone", previousController: 1, currentController: 0 },
    ]);
  });
});

function createFixture(seed: number): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [seleglareCode] }, 1: { main: [opponentMonsterCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: seleglareCode, name: "Seleglare the Luminous Lunar Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 6, attack: 2400, defense: 1000 },
    { code: opponentMonsterCode, name: "Seleglare Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Seleglare the Luminous Lunar Dragon");
  expect(script).toContain("e1:SetCode(EFFECT_SUMMON_PROC)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_PROC)");
  expect(script).toContain("return minc==0 and c:IsLevelAbove(5) and Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0");
  expect(script).toContain("e1:SetCode(EFFECT_SET_BASE_ATTACK)");
  expect(script).toContain("e1:SetValue(1500)");
  expect(script).toContain("e3:SetCategory(CATEGORY_TOHAND+CATEGORY_CONTROL)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e3:SetRange(LOCATION_MZONE)");
  expect(script).toContain("return Duel.IsMainPhase()");
  expect(script).toContain("return c:IsFaceup() and c:GetAttack()<=atk and c:IsControlerCanBeChanged()");
  expect(script).toContain("Duel.SelectTarget(tp,s.confilter,tp,0,LOCATION_MZONE,1,1,nil,atk)");
  expect(script).toContain("Duel.SendtoHand(c,nil,REASON_EFFECT)~0");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerSeleglare(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(seleglareCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
