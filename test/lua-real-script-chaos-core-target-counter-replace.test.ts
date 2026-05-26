import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { ApplyDuelResponseResult, DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const chaosCoreCode = "54040484";
const hamonCode = "32491822";
const ravielCode = "69890967";
const uriaCode = "6007213";
const targeterCode = "540404840";
const attackerCode = "540404841";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasChaosCoreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chaosCoreCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const counterPhantasm = 0x202;

describe.skipIf(!hasUpstreamScripts || !hasChaosCoreScript)("Lua real script Chaos Core target counter replacement", () => {
  it("restores targeted SelectUnselectGroup sends into counters, damage prevention, and counter destruction replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${chaosCoreCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 54040484, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chaosCoreCode, hamonCode, ravielCode, uriaCode] }, 1: { main: [targeterCode, attackerCode] } });
    startDuel(session);

    const chaosCore = requireCard(session, chaosCoreCode);
    const hamon = requireCard(session, hamonCode);
    const raviel = requireCard(session, ravielCode);
    const uria = requireCard(session, uriaCode);
    const targeter = requireCard(session, targeterCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpAttack(session, chaosCore, 0, 0);
    moveDuelCard(session.state, hamon.uid, "deck", 0);
    moveDuelCard(session.state, raviel.uid, "hand", 0);
    moveDuelCard(session.state, uria.uid, "deck", 0);
    moveDuelCard(session.state, targeter.uid, "hand", 1);
    moveFaceUpAttack(session, attacker, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${targeterCode}.lua`) return targeterScript(chaosCoreCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [chaosCoreCode, targeterCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);

    const target = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === targeter.uid);
    expect(target, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, target!);
    expect(session.state.chain[0]?.targetUids).toEqual([chaosCore.uid]);
    expect(getLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === chaosCore.uid)).toBe(true);

    const restoredTargeted = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTargeted);
    expectRestoredLegalActions(restoredTargeted, 0);
    const chaosResponse = getLuaRestoreLegalActions(restoredTargeted, 0).find((action) => action.type === "activateEffect" && action.uid === chaosCore.uid);
    expect(chaosResponse, JSON.stringify(getLuaRestoreLegalActions(restoredTargeted, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTargeted, chaosResponse!);
    resolveRestoredChain(restoredTargeted);

    expect(findCard(restoredTargeted.session, hamon.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: chaosCore.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restoredTargeted.session, raviel.uid)).toMatchObject({ location: "hand" });
    expect(findCard(restoredTargeted.session, uria.uid)).toMatchObject({ location: "deck" });
    expect(getDuelCardCounter(findCard(restoredTargeted.session, chaosCore.uid), counterPhantasm)).toBe(1);
    expect(restoredTargeted.session.state.effects.some((effect) => effect.code === 201 && effect.sourceUid === chaosCore.uid && effect.targetRange?.[0] === 1)).toBe(true);
    expect(restoredTargeted.session.state.eventHistory.filter((event) => ["sentToGraveyard", "counterAdded"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: hamon.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: chaosCore.uid, eventReasonEffectId: 2, previous: "deck", current: "graveyard" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: chaosCore.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: chaosCore.uid, eventReasonEffectId: 2, previous: "deck", current: "monsterZone" },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredTargeted.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 1;
    restoredBattle.session.state.waitingFor = 1;
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === chaosCore.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyAndAssert(restoredBattle.session, attack!);
    passBattleResponses(restoredBattle.session);
    expect(restoredBattle.session.state.battleDamage[0] ?? 0).toBe(0);
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([]);

    const restoredReplacement = restoreDuelWithLuaScripts(serializeDuel(restoredTargeted.session), source, reader);
    expectCleanRestore(restoredReplacement);
    expectRestoredLegalActions(restoredReplacement, 1);
    destroyDuelCard(restoredReplacement.session.state, chaosCore.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredReplacement.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 96, returned: true },
    ]);
    expect(findCard(restoredReplacement.session, chaosCore.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(getDuelCardCounter(findCard(restoredReplacement.session, chaosCore.uid), counterPhantasm)).toBe(0);
    expect(restoredReplacement.session.state.log).toContainEqual(expect.objectContaining({ action: "destroyReplace", player: 0, card: chaosCore.name, detail: "Destruction replaced" }));
  });
});

function cards(): DuelCardData[] {
  return [
    { code: chaosCoreCode, name: "Chaos Core", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 3, attack: 0, defense: 0 },
    { code: hamonCode, name: "Hamon, Lord of Striking Thunder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 10, attack: 4000, defense: 4000 },
    { code: ravielCode, name: "Raviel, Lord of Phantasms", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 10, attack: 4000, defense: 4000 },
    { code: uriaCode, name: "Uria, Lord of Searing Flames", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 10, attack: 0, defense: 0 },
    { code: targeterCode, name: "Chaos Core Targeter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    { code: attackerCode, name: "Chaos Core Battle Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1000 },
  ];
}

function targeterScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${targetCode}) end
        Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_MZONE,1,1,nil,${targetCode})
      end)
      e:SetOperation(function(e,tp) Debug.Message("chaos core targeter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Chaos Core");
  expect(script).toContain("c:EnableCounterPermit(0x202)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER+CATEGORY_TOGRAVE)");
  expect(script).toContain("e1:SetCode(EVENT_BECOME_TARGET)");
  expect(script).toContain("e2:SetCode(EVENT_BE_BATTLE_TARGET)");
  expect(script).toContain("return c:IsCode(69890967,6007213,32491822) and c:IsAbleToGrave()");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,1,3,s.ctcheck,1,tp,HINTMSG_TOGRAVE)");
  expect(script).toContain("local oc=#(Duel.GetOperatedGroup())");
  expect(script).toContain("c:AddCounter(0x202,oc)");
  expect(script).toContain("e1:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
  expect(script).toContain("e3:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x202,1,REASON_EFFECT)");
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
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}): object {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
  };
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): ApplyDuelResponseResult {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (;;) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const resolve = getLuaRestoreLegalActions(restored, player).find((action) => (action as { type: string }).type === "resolveChain");
    if (!resolve) return;
    applyLuaRestoreAndAssert(restored, resolve);
  }
}

function passBattleResponses(session: DuelSession): void {
  for (;;) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const action = getLegalActions(session, player).find((candidate) => (candidate as { type: string }).type === "pass");
    if (!action) return;
    applyAndAssert(session, action);
  }
}
