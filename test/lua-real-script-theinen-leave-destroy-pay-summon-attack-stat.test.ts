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
const theinenCode = "87997872";
const androCode = "15013468";
const teleiaCode = "51402177";
const destroyerCode = "879978720";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTheinenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${theinenCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasTheinenScript)("Lua real script Theinen leave destroy pay summon attack stat", () => {
  it("restores deck reveal LP-cost summon after both Sphinx monsters leave destroyed and LP-cost ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${theinenCode}.lua`);
    expectScriptShape(script);
    const source = sourceWithDestroyer(workspace);
    const reader = createCardReader(cards());
    const restoredLeave = createRestoredTheinenField({ reader, source, workspace });
    expectCleanRestore(restoredLeave);
    expectRestoredLegalActions(restoredLeave, 1);
    const theinen = requireCard(restoredLeave.session, theinenCode);
    const andro = requireCard(restoredLeave.session, androCode);
    const teleia = requireCard(restoredLeave.session, teleiaCode);
    const destroyer = requireCard(restoredLeave.session, destroyerCode);

    const destroyBoth = getLuaRestoreLegalActions(restoredLeave, 1).find((action) =>
      action.type === "activateEffect" && action.uid === destroyer.uid
    );
    expect(destroyBoth, JSON.stringify(getLuaRestoreLegalActions(restoredLeave, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLeave, destroyBoth!);
    resolveRestoredChain(restoredLeave);

    expect(restoredLeave.session.state.cards.find((card) => card.uid === andro.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: destroyer.uid,
      reasonEffectId: 6,
    });
    expect(restoredLeave.session.state.cards.find((card) => card.uid === teleia.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: destroyer.uid,
      reasonEffectId: 6,
    });

    const summonTheinen = getLuaRestoreLegalActions(restoredLeave, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === theinen.uid
    );
    expect(summonTheinen, JSON.stringify(getLuaRestoreLegalActions(restoredLeave, 0), null, 2)).toBeDefined();
    expect(summonTheinen).toMatchObject({ effectId: "lua-4-1015", player: 0, uid: theinen.uid });
    applyRestoredActionAndAssert(restoredLeave, summonTheinen!);
    resolveRestoredChain(restoredLeave);

    expect(restoredLeave.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredLeave.session.state.cards.find((card) => card.uid === theinen.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: theinen.uid,
      reasonEffectId: 4,
    });
    expect(restoredLeave.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-5-1102",
        eventCardUid: theinen.uid,
        eventCode: 1102,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: theinen.uid,
        eventReasonEffectId: 4,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: theinen.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const boostTheinen = getLuaRestoreLegalActions(restoredLeave, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === theinen.uid
    );
    expect(boostTheinen, JSON.stringify(getLuaRestoreLegalActions(restoredLeave, 0), null, 2)).toBeDefined();
    expect(boostTheinen).toMatchObject({ effectId: "lua-5-1102", player: 0, uid: theinen.uid });
    applyRestoredActionAndAssert(restoredLeave, boostTheinen!);
    resolveRestoredChain(restoredLeave);

    expect(restoredLeave.session.state.players[0].lifePoints).toBe(7000);
    expect(currentAttack(restoredLeave.session.state.cards.find((card) => card.uid === theinen.uid), restoredLeave.session.state)).toBe(6500);
    expect(restoredLeave.session.state.effects.filter((effect) => effect.sourceUid === theinen.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: undefined, reset: { flags: 1107235328 }, sourceUid: theinen.uid, value: 3000 },
    ]);
    expect(restoredLeave.session.state.eventHistory.filter((event) => ["lifePointCostPaid", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: undefined, eventCode: 1201, eventName: "lifePointCostPaid", eventPlayer: 0, eventValue: 500, eventReason: duelReason.cost, eventReasonCardUid: theinen.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: undefined, current: undefined },
      { eventCardUid: theinen.uid, eventCode: 1102, eventName: "specialSummoned", eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: theinen.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "deck", current: "monsterZone" },
      { eventCardUid: undefined, eventCode: 1201, eventName: "lifePointCostPaid", eventPlayer: 0, eventValue: 500, eventReason: duelReason.cost, eventReasonCardUid: theinen.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: undefined, current: undefined },
    ]);
    expect(restoredLeave.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredTheinenField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 87997872, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [theinenCode, androCode, teleiaCode] },
    1: { main: [destroyerCode] },
  });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, androCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, teleiaCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, destroyerCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(theinenCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(destroyerCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Theinen the Great Sphinx");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("e2:SetCost(Cost.PayLP(500))");
  expect(script).toContain("e3:SetRange(LOCATION_DECK)");
  expect(script).toContain("eg:IsExists(s.cfilter,1,nil,tp,15013468)");
  expect(script).toContain("eg:IsExists(s.cfilter,1,nil,tp,51402177)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,e:GetHandler())");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,true,false,POS_FACEUP)");
  expect(script).toContain("c:CompleteProcedure()");
  expect(script).toContain("e4:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e4:SetCost(Cost.PayLP(500))");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(3000)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: theinenCode, name: "Theinen the Great Sphinx", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeLight, level: 10, attack: 3500, defense: 3000 },
    { code: androCode, name: "Andro Sphinx", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeLight, level: 10, attack: 3000, defense: 2500 },
    { code: teleiaCode, name: "Sphinx Teleia", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeLight, level: 10, attack: 2500, defense: 3000 },
    { code: destroyerCode, name: "Theinen Opponent Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function sourceWithDestroyer(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${destroyerCode}.lua`) return destroyerScript();
      return workspace.readScript(name);
    },
  };
}

function destroyerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      local g=Duel.GetMatchingGroup(function(tc) return tc:IsControler(1-tp) and tc:IsLocation(LOCATION_MZONE) and (tc:IsCode(${androCode}) or tc:IsCode(${teleiaCode})) end,tp,0,LOCATION_MZONE,nil)
      if #g>0 then Duel.Destroy(g,REASON_EFFECT) end
      Debug.Message("theinen destroyer resolved")
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
