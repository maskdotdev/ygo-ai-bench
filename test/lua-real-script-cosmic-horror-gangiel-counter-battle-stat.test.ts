import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gangielCode = "51192573";
const alienDefenderCode = "511925730";
const opponentTargetCode = "511925731";
const alienTributeCode = "511925732";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGangielScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gangielCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const attributeLight = 0x10;
const setAlien = 0xc;
const counterA = 0x100e;
const categoryCounter = 0x800000;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasGangielScript)("Lua real script Cosmic Horror Gangi'el counter battle stat", () => {
  it("restores targeted A-Counter placement and battle stat reduction against Aliens", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectGangielScriptShape(workspace.readScript(`official/c${gangielCode}.lua`));
    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${opponentTargetCode}.lua`) return counterPermitScript();
        return workspace.readScript(name);
      },
    };
    const restoredOpen = createRestoredOpen({ reader, source, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const gangiel = requireCard(restoredOpen.session, gangielCode);
    const target = requireCard(restoredOpen.session, opponentTargetCode);

    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === gangiel.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { category: undefined, code: 32, countLimit: undefined, event: "continuous", id: "lua-1-32", property: 263168, range: ["monsterZone"], targetRange: undefined },
      { category: categoryCounter, code: undefined, countLimit: 1, event: "ignition", id: "lua-2", property: 16, range: ["monsterZone"], targetRange: undefined },
      { category: undefined, code: effectUpdateAttack, countLimit: undefined, event: "continuous", id: "lua-3-100", property: undefined, range: ["monsterZone"], targetRange: [4, 4] },
      { category: undefined, code: effectUpdateDefense, countLimit: undefined, event: "continuous", id: "lua-4-104", property: undefined, range: ["monsterZone"], targetRange: [4, 4] },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === gangiel.uid && action.effectId === "lua-2"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(getDuelCardCounter(findCard(restoredOpen.session, target.uid), counterA)).toBe(1);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: gangiel.uid, eventReasonEffectId: 2, relatedEffectId: undefined },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const alienDefender = requireCard(restoredBattle.session, alienDefenderCode);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === alienDefender.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passBattleUntilDamageCalculation(restoredBattle);

    expect(restoredBattle.session.state.battleStep).toBe("damageCalculation");
    expect(currentAttack(findCard(restoredBattle.session, target.uid), restoredBattle.session.state)).toBe(1500);
    expect(currentDefense(findCard(restoredBattle.session, target.uid), restoredBattle.session.state)).toBe(1100);
    expect(currentAttack(findCard(restoredBattle.session, alienDefender.uid), restoredBattle.session.state)).toBe(1400);
    expect(currentDefense(findCard(restoredBattle.session, alienDefender.uid), restoredBattle.session.state)).toBe(1200);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOpen({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 51192573, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gangielCode, alienDefenderCode, alienTributeCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, gangielCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, alienDefenderCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, alienTributeCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gangielCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(opponentTargetCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function cards(): DuelCardData[] {
  return [
    { code: gangielCode, name: "Cosmic Horror Gangi'el", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeLight, setcodes: [setAlien], level: 7, attack: 2600, defense: 2000 },
    { code: alienDefenderCode, name: "Gangi'el Alien Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeLight, setcodes: [setAlien], level: 4, attack: 1400, defense: 1200 },
    { code: opponentTargetCode, name: "Gangi'el Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeLight, level: 4, attack: 1800, defense: 1400 },
    { code: alienTributeCode, name: "Gangi'el Alien Tribute", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeLight, setcodes: [setAlien], level: 4, attack: 1000, defense: 1000 },
  ];
}

function counterPermitScript(): string {
  return "local s,id=GetID(); function s.initial_effect(c) c:EnableCounterPermit(COUNTER_A) end";
}

function expectGangielScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Cosmic Horror Gangi'el");
  expect(script).toContain("aux.AddNormalSummonProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,aux.Stringid(id,0),s.otfilter)");
  expect(script).toContain("return c:GetOwner()==1-tp");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,COUNTER_A,1)");
  expect(script).toContain("tc:AddCounter(COUNTER_A,1)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e4:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("return Duel.IsPhase(PHASE_DAMAGE_CAL) and Duel.GetAttackTarget()");
  expect(script).toContain("local bc=c:GetBattleTarget()");
  expect(script).toContain("return bc and c:GetCounter(COUNTER_A)~=0 and bc:IsSetCard(SET_ALIEN)");
  expect(script).toContain("return c:GetCounter(COUNTER_A)*-300");
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

function passBattleUntilDamageCalculation(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.battleStep !== "damageCalculation") {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
