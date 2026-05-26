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
const darkRulerCode = "69831560";
const materialACode = "698315600";
const materialBCode = "698315601";
const materialCCode = "698315602";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDarkRulerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darkRulerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryCoin = 0x1000000;
const effectExtraAttack = 194;
const effectCannotChangePosition = 14;

describe.skipIf(!hasUpstreamScripts || !hasDarkRulerScript)("Lua real script Arcana Force EX Dark Ruler procedure position", () => {
  it("restores SelectUnselectGroup summon cost into heads extra attack and Battle Phase position lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${darkRulerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 151, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkRulerCode, materialACode, materialBCode, materialCCode] }, 1: { main: [] } });
    startDuel(session);

    const darkRuler = requireCard(session, darkRulerCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const materialC = requireCard(session, materialCCode);
    moveDuelCard(session.state, darkRuler.uid, "hand", 0);
    moveFaceUpAttack(session, materialA, 0, 0);
    moveFaceUpAttack(session, materialB, 0, 1);
    moveFaceUpAttack(session, materialC, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkRulerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === darkRuler.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["hand"], triggerEvent: undefined },
      { category: undefined, code: 34, event: "summonProcedure", property: 262144, range: ["hand"], triggerEvent: undefined },
      { category: undefined, code: 30, event: "continuous", property: 263168, range: ["hand"], triggerEvent: undefined },
      { category: categoryCoin, code: 1102, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
    ]);

    const procedure = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === darkRuler.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, procedure!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === darkRuler.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    for (const material of [materialA, materialB, materialC]) {
      expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: darkRuler.uid,
      });
    }

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === darkRuler.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.lastCoinResults).toEqual([1]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) =>
      event.eventName === "specialSummoned" || event.eventName === "coinTossed"
    ).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: darkRuler.uid, eventPlayer: undefined, eventReason: 2064, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventValue: undefined },
      { eventName: "coinTossed", eventCode: 1151, eventCardUid: undefined, eventPlayer: 0, eventReason: 64, eventReasonCardUid: darkRuler.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, eventValue: 1 },
    ]);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === darkRuler.uid && [effectExtraAttack, 4224, 1019].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: effectExtraAttack, event: "continuous", range: ["monsterZone"], triggerEvent: undefined },
      { code: 4224, event: "continuous", range: ["monsterZone"], triggerEvent: undefined },
      { code: 1019, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "leftField" },
    ]);

    const restoredCoin = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredCoin);
    expectRestoredLegalActions(restoredCoin, 0);
    restoredCoin.session.state.attacksDeclared.push(darkRuler.uid, darkRuler.uid);
    const battle = getLuaRestoreLegalActions(restoredCoin, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredCoin, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCoin, battle!);
    expect(restoredCoin.session.state.pendingTriggers).toEqual([]);
    expect(restoredCoin.session.state.cards.find((card) => card.uid === darkRuler.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
    });
    expect(restoredCoin.session.state.effects.filter((effect) => effect.sourceUid === darkRuler.uid && effect.code === effectCannotChangePosition).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectCannotChangePosition, property: 67118080, reset: { flags: 1375605248, count: 2 }, sourceUid: darkRuler.uid },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force EX - The Dark Ruler");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("return Duel.GetLocationCount(tp,LOCATION_MZONE)>-3 and #rg>2 and aux.SelectUnselectGroup(rg,e,tp,3,3,nil,0)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,3,3,nil,1,tp,HINTMSG_TOGRAVE,nil,nil,true)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("e3:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("s.arcanareg(c,Arcana.TossCoin(c,tp))");
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_ATTACK)");
  expect(script).toContain("return Arcana.GetCoinResult(e:GetHandler())==COIN_HEADS");
  expect(script).toContain("return Arcana.GetCoinResult(c)==COIN_HEADS and c:GetAttackAnnouncedCount()>=2");
  expect(script).toContain("Duel.ChangePosition(c,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_CHANGE_POSITION)");
  expect(script).toContain("e3:SetCode(EVENT_LEAVE_FIELD_P)");
  expect(script).toContain("Arcana.GetCoinResult(e:GetHandler())==COIN_TAILS");
  expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_ONFIELD,LOCATION_ONFIELD)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("Arcana.RegisterCoinResult(c,coin)");
}

function cards(): DuelCardData[] {
  return [
    { code: darkRulerCode, name: "Arcana Force EX - The Dark Ruler", kind: "monster", typeFlags: typeMonster | typeEffect, level: 10, attack: 4000, defense: 4000 },
    { code: materialACode, name: "Dark Ruler Material A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Dark Ruler Material B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1100, defense: 1000 },
    { code: materialCCode, name: "Dark Ruler Material C", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
  ];
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
