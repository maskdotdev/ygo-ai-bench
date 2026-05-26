import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const avramaxCode = "21887175";
const opponentSpecialCode = "218871750";
const opponentDestroySpellCode = "218871751";
const ownTargetCode = "218871752";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAvramaxScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${avramaxCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const typeSpell = 0x2;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const summonTypeLink = 0x4c000000;
const effectUpdateAttack = 100;
const effectCannotBeEffectTarget = 71;
const effectCannotSelectBattleTarget = 332;

describe.skipIf(!hasUpstreamScripts || !hasAvramaxScript)("Lua real script Mekk-Knight Crusadia Avramax link protect precalc to-Deck stat", () => {
  it("restores Link Summoned protection effects and pre-damage ATK gain against Special Summoned monster", () => {
    const { workspace, source, reader, session } = createAvramaxSession(21887175);
    const avramax = requireCard(session, avramaxCode);
    const opponent = requireCard(session, opponentSpecialCode);
    moveFaceUpAttack(session, avramax, 0, 0);
    avramax.summonType = "link";
    avramax.summonTypeCode = summonTypeLink;
    moveFaceUpAttack(session, opponent, 1, 0);
    opponent.summonType = "special";
    opponent.summonTypeCode = 0x40000000;
    opponent.summonPlayer = 1;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(avramaxCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === avramax.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", id: "lua-1-31", property: 0x40400, range: ["monsterZone"] },
      { category: undefined, code: effectCannotBeEffectTarget, event: "continuous", id: "lua-2-71", property: 0x20000, range: ["monsterZone"] },
      { category: undefined, code: effectCannotSelectBattleTarget, event: "continuous", id: "lua-3-332", property: undefined, range: ["monsterZone"] },
      { category: 0x200000, code: 1134, event: "quick", id: "lua-4-1134", property: undefined, range: ["monsterZone"] },
      { category: 0x10, code: 1014, event: "trigger", id: "lua-5-1014", property: 0x10000, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === avramax.uid && action.targetUid === opponent.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passBattleUntilBeforeDamage(restoredOpen);

    const boost = passUntilAvramaxBoost(restoredOpen, avramax.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    resolveRestoredChain(restoredOpen);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === avramax.uid), restoredOpen.session.state)).toBe(5000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === avramax.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169344 }, sourceUid: avramax.uid, value: 2000 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores opponent-effect to-Grave trigger into field card shuffle", () => {
    const { workspace, source, reader, session } = createAvramaxSession(21887176);
    const avramax = requireCard(session, avramaxCode);
    const destroySpell = requireCard(session, opponentDestroySpellCode);
    const ownTarget = requireCard(session, ownTargetCode);
    moveFaceUpAttack(session, avramax, 0, 0);
    avramax.summonType = "link";
    avramax.summonTypeCode = summonTypeLink;
    moveFaceUpAttack(session, ownTarget, 0, 1);
    moveDuelCard(session.state, destroySpell.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(avramaxCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentDestroySpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const destroy = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === destroySpell.uid);
    expect(destroy, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, destroy!);
    resolveEngineChain(session);
    expect(session.state.cards.find((card) => card.uid === avramax.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 1,
      reasonCardUid: destroySpell.uid,
      reasonEffectId: 6,
    });
    session.state.waitingFor = 0;

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const shuffle = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === avramax.uid && action.effectId === "lua-5-1014");
    expect(shuffle, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, shuffle!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === ownTarget.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: avramax.uid,
      reasonEffectId: 5,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToDeck"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "graveyard", eventCardUid: avramax.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: destroySpell.uid, eventReasonEffectId: 6, eventReasonPlayer: 1, previous: "monsterZone" },
      { current: "graveyard", eventCardUid: destroySpell.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "spellTrapZone" },
      { current: "deck", eventCardUid: ownTarget.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: avramax.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createAvramaxSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${avramaxCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [ownTargetCode], extra: [avramaxCode] },
    1: { main: [opponentSpecialCode, opponentDestroySpellCode] },
  });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${opponentDestroySpellCode}.lua`) return opponentDestroyScript(avramaxCode);
      return workspace.readScript(name);
    },
  };
  return { workspace, source, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Mekk-Knight Crusadia Avramax");
  expect(script).toContain("Link.AddProcedure(c,s.mfilter,2)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("e1:SetValue(aux.tgoval)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)");
  expect(script).toContain("return e:GetHandler()~=c");
  expect(script).toContain("e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("return bc and bc:IsSpecialSummoned() and bc:IsControler(1-tp)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(bc:GetAttack())");
  expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousControler(tp) and c:IsLinkSummoned() and rp==1-tp");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToDeck,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: avramaxCode, name: "Mekk-Knight Crusadia Avramax", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeLight, level: 4, attack: 3000, defense: 0, linkMarkers: 0x20 },
    { code: opponentSpecialCode, name: "Avramax Fixture Special Summoned Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2000, defense: 1000 },
    { code: opponentDestroySpellCode, name: "Avramax Fixture Opponent Destroy Spell", kind: "spell", typeFlags: typeSpell },
    { code: ownTargetCode, name: "Avramax Fixture Own Shuffle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function opponentDestroyScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${targetCode}) end
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,nil,1,1-tp,LOCATION_MZONE)
      end)
      e:SetOperation(function(e,tp)
        local g=Duel.SelectMatchingCard(tp,Card.IsCode,tp,0,LOCATION_MZONE,1,1,nil,${targetCode})
        Duel.SendtoGrave(g,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}

function resolveEngineChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
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

function passBattleUntilBeforeDamage(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.battleWindow?.kind !== "beforeDamageCalculation") {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passUntilAvramaxBoost(restored: ReturnType<typeof restoreDuelWithLuaScripts>, avramaxUid: string): DuelAction {
  let guard = 0;
  while (true) {
    expect(++guard).toBeLessThan(10);
    for (const player of [0, 1] as const) {
      const action = getLuaRestoreLegalActions(restored, player).find((candidate) =>
        candidate.type === "activateEffect" && candidate.uid === avramaxUid && candidate.effectId === "lua-4-1134"
      );
      if (action) return action;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage" || action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
