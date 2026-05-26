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
const caninetaurCode = "91754175";
const sendCode = "917541750";
const decoyCode = "917541751";
const defenderCode = "917541752";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCaninetaurScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${caninetaurCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const raceBeastWarrior = 0x8000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const categoryAtkChange = 0x200000;
const categoryToGrave = 0x20;
const eventPreDamageCalculate = 1134;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCaninetaurScript)("Lua real script Caninetaur pre-calc send level stat", () => {
  it("restores pre-damage battle target quick send into Level-based ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${caninetaurCode}.lua`);
    expectCaninetaurScriptShape(script);
    const caninetaurData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === caninetaurCode);
    expect(caninetaurData).toBeDefined();
    const reader = createCardReader([caninetaurData!, ...fixtureCards()]);
    const restoredOpen = createRestoredBattleOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const caninetaur = requireCard(restoredOpen.session, caninetaurCode);
    const sent = requireCard(restoredOpen.session, sendCode);
    const decoy = requireCard(restoredOpen.session, decoyCode);
    const defender = requireCard(restoredOpen.session, defenderCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === caninetaur.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toContainEqual({ category: categoryToGrave + categoryAtkChange, code: eventPreDamageCalculate, event: "quick", range: ["monsterZone"], sourceUid: caninetaur.uid });

    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === caninetaur.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passRestoredBattleUntil(restoredOpen, () => findRestoredAction(restoredOpen, [1, 0], (action) => action.type === "activateEffect" && action.uid === caninetaur.uid) !== undefined);

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    const preDamagePlayer = restoredPreDamage.session.state.waitingFor ?? restoredPreDamage.session.state.turnPlayer;
    expectRestoredLegalActions(restoredPreDamage, preDamagePlayer);
    const quick = findRestoredAction(restoredPreDamage, [1, 0], (action) =>
      action.type === "activateEffect" && action.uid === caninetaur.uid && action.effectId === "lua-1-1134"
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, preDamagePlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, quick!);
    resolveRestoredChain(restoredPreDamage);

    expect(restoredPreDamage.session.state.cards.find((card) => card.uid === sent.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: caninetaur.uid,
      reasonEffectId: 1,
    });
    expect(restoredPreDamage.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === caninetaur.uid), restoredPreDamage.session.state)).toBe(2100);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === caninetaur.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: undefined, range: ["monsterZone"], reset: { flags: 1107169408 }, sourceUid: caninetaur.uid, value: 600 },
    ]);
    expect(restoredPreDamage.session.state.eventHistory.filter((event) => ["sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: sent.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: caninetaur.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
    expect(restoredPreDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredBattleOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 91754175, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [caninetaurCode, sendCode, decoyCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, caninetaurCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(caninetaurCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: sendCode, name: "Caninetaur Level Send", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeEarth, level: 6, attack: 1400, defense: 1000 },
    { code: decoyCode, name: "Caninetaur Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 8, attack: 2200, defense: 1000 },
    { code: defenderCode, name: "Caninetaur Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
  ];
}

function expectCaninetaurScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Caninetaur");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOGRAVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("return e:GetHandler():GetBattleTarget()");
  expect(script).toContain("return c:IsRace(RACES_BEAST_BWARRIOR_WINGB) and c:IsAbleToGrave()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_HAND|LOCATION_DECK)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT)");
  expect(script).toContain("c:IsRelateToBattle() and c:IsFaceup()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(lv*100)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function findRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, players: PlayerId[], predicate: (action: DuelAction) => boolean): DuelAction | undefined {
  for (const player of players) {
    const action = getLuaRestoreLegalActions(restored, player).find(predicate);
    if (action) return action;
  }
  return undefined;
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0 && guard < 10) {
    guard += 1;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
  expect(guard).toBeLessThan(10);
}

function passRestoredBattleUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
