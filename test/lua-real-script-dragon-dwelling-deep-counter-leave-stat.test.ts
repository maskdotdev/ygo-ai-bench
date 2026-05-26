import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dragonCode = "4404099";
const fishCode = "44040990";
const seaSerpentCode = "44040991";
const warriorCode = "44040992";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragonCode}.lua`));
const counterDeepSea = 0x23;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFish = 0x4000000;
const raceSeaSerpent = 0x4000;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const categoryCounter = 0x800000;
const effectCounterPermit = 0x10000 + counterDeepSea;
const eventLeaveField = 1015;
const eventLeaveFieldP = 1019;
const eventStandbyPhase = 0x1000 + 0x2;

describe.skipIf(!hasUpstreamScripts || !hasDragonScript)("Lua real script Dragon Dwelling Deep counter leave stat", () => {
  it("restores standby counter metadata and leave-field counter snapshot trigger availability", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dragonCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 4404099, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dragonCode, fishCode, seaSerpentCode, warriorCode] }, 1: { main: [] } });
    startDuel(session);

    const dragon = moveFaceUpAttack(session, requireCard(session, dragonCode), 0, 0);
    const fish = moveFaceUpAttack(session, requireCard(session, fishCode), 0, 1);
    const seaSerpent = moveFaceUpAttack(session, requireCard(session, seaSerpentCode), 0, 2);
    const warrior = moveFaceUpAttack(session, requireCard(session, warriorCode), 0, 3);
    expect(addDuelCardCounter(dragon, counterDeepSea, 2)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === dragon.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: effectCounterPermit, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: dragon.uid },
      { category: categoryCounter, code: eventStandbyPhase, event: "trigger", property: undefined, range: ["monsterZone"], sourceUid: dragon.uid },
      { category: undefined, code: eventLeaveFieldP, event: "continuous", property: 0x400, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], sourceUid: dragon.uid },
      { category: undefined, code: eventLeaveField, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], sourceUid: dragon.uid },
    ]);

    destroyDuelCard(restored.session.state, dragon.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(findCard(restored.session, dragon.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(getDuelCardCounter(findCard(restored.session, dragon.uid), counterDeepSea)).toBe(0);
    const restoredLeaveTrigger = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredLeaveTrigger);
    expectRestoredLegalActions(restoredLeaveTrigger, 0);
    const leaveTrigger = getLuaRestoreLegalActions(restoredLeaveTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === dragon.uid
    );
    expect(leaveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredLeaveTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLeaveTrigger, leaveTrigger!);
    expect(restoredLeaveTrigger.session.state.effects.filter((effect) => [fish.uid, seaSerpent.uid, warrior.uid].includes(effect.sourceUid) && effect.code === 100)).toEqual([]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: dragonCode, name: "The Dragon Dwelling in the Deep", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeWater, level: 4, attack: 1700, defense: 1400 },
    { code: fishCode, name: "Deep Fish Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
    { code: seaSerpentCode, name: "Deep Sea Serpent Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeWater, level: 4, attack: 1500, defense: 1000 },
    { code: warriorCode, name: "Deep Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWater, level: 4, attack: 1700, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--The Dragon Dwelling in the Deep");
  expect(script).toContain("c:EnableCounterPermit(0x23)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x23)");
  expect(script).toContain("e:GetHandler():AddCounter(0x23,1)");
  expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD_P)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e2:SetOperation(s.regop)");
  expect(script).toContain("e3:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("local ct=e:GetHandler():GetCounter(0x23)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsRace,RACE_FISH|RACE_SEASERPENT),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel()*200)");
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
