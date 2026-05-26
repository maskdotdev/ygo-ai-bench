import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
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
const serpentCode = "36278828";
const targetCode = "362788280";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSerpentScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${serpentCode}.lua`));
const counterVenom = 0x1009;
const eventCustomVenomSwamp = 0x10000000 + 54306223;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasSerpentScript)("Lua real script Venom Serpent counter custom event", () => {
  it("restores opponent Venom Counter targeting and zero-ATK custom event", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${serpentCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const session = createDuel({ seed: 36278828, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [serpentCode] }, 1: { main: [targetCode] } });
    startDuel(session);
    const serpent = requireCard(session, serpentCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, serpent, 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = fixtureSource(workspace);
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(serpentCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(targetCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(currentAttack(findCard(restored.session, target.uid), restored.session.state)).toBe(500);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === serpent.uid).map((effect) => ({
      category: effect.category,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      range: effect.range,
    }))).toEqual([
      { category: 0x800000, countLimit: 1, event: "ignition", id: "lua-1", range: ["monsterZone"] },
    ]);

    const ignition = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === serpent.uid && action.effectId === "lua-1");
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, ignition!);

    expect(getDuelCardCounter(findCard(restored.session, target.uid), counterVenom)).toBe(1);
    expect(currentAttack(findCard(restored.session, target.uid), restored.session.state)).toBe(0);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "counterAdded", "customEvent"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: target.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainLinkId: "chain-2",
        eventChainDepth: 1,
      },
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: target.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: serpent.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "customEvent",
        eventCode: eventCustomVenomSwamp,
        eventCardUid: target.uid,
        eventPlayer: 0,
        eventValue: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: serpent.uid,
        eventReasonEffectId: 1,
        relatedEffectId: 1,
        eventUids: [target.uid],
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(getLuaRestoreLegalActions(restoredResolved, 0).some((action) => action.type === "activateEffect" && action.uid === serpent.uid)).toBe(false);
    expect(getDuelCardCounter(findCard(restoredResolved.session, target.uid), counterVenom)).toBe(1);
    expect(currentAttack(findCard(restoredResolved.session, target.uid), restoredResolved.session.state)).toBe(0);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const serpent = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === serpentCode);
  expect(serpent).toBeDefined();
  return [
    serpent!,
    { code: targetCode, name: "Venom Serpent Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 500, defense: 1000 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${targetCode}.lua`) return counterTargetScript();
      return workspace.readScript(name);
    },
  };
}

function counterTargetScript(): string {
  return `
local s,id=GetID()
function s.initial_effect(c)
  c:EnableCounterPermit(COUNTER_VENOM,LOCATION_MZONE)
  local e=Effect.CreateEffect(c)
  e:SetType(EFFECT_TYPE_SINGLE)
  e:SetCode(EFFECT_UPDATE_ATTACK)
  e:SetRange(LOCATION_MZONE)
  e:SetValue(function(e,c) return c:GetCounter(COUNTER_VENOM)*-500 end)
  c:RegisterEffect(e)
end
`;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Venom Serpent");
  expect(script).toContain("s.counter_place_list={COUNTER_VENOM}");
  expect(script).toContain("chkc:IsControler(1-tp) and chkc:IsCanAddCounter(COUNTER_VENOM,1)");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,nil,COUNTER_VENOM,1)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_VENOM,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0)");
  expect(script).toContain("local atk=tc:GetAttack()");
  expect(script).toContain("tc:AddCounter(COUNTER_VENOM,1)");
  expect(script).toContain("if atk>0 and tc:GetAttack()==0 then");
  expect(script).toContain("Duel.RaiseEvent(tc,EVENT_CUSTOM+54306223,e,0,0,0,0)");
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
