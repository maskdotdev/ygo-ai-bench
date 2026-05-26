import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const metalSlaveCode = "41516133";
const costMonsterCode = "415161330";
const targetMonsterCode = "415161331";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMetalSlaveScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${metalSlaveCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setBes = 0x15;
const counterBes = 0x1f;

describe.skipIf(!hasUpstreamScripts || !hasMetalSlaveScript)("Lua real script Super BES Metal Slave counter summon", () => {
  it("restores SelectUnselectGroup send cost into Special Summon and counter placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${metalSlaveCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 41516133, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [metalSlaveCode, costMonsterCode, targetMonsterCode] }, 1: { main: [] } });
    startDuel(session);
    const metalSlave = requireCard(session, metalSlaveCode);
    const costMonster = requireCard(session, costMonsterCode);
    moveDuelCard(session.state, metalSlave.uid, "hand", 0);
    moveDuelCard(session.state, costMonster.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(metalSlaveCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === metalSlave.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 0x10000 + counterBes, event: "continuous", property: undefined, range: ["hand"], triggerEvent: undefined },
      { category: 8389120, code: undefined, event: "ignition", property: undefined, range: ["hand"], triggerEvent: undefined },
      { category: 1, code: 1002, event: "quick", property: 16, range: ["monsterZone"], triggerEvent: undefined },
    ]);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === metalSlave.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, action!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === metalSlave.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: metalSlave.uid,
      reasonEffectId: 2,
    });
    expect(getDuelCardCounter(restoredOpen.session.state.cards.find((card) => card.uid === metalSlave.uid), counterBes)).toBe(1);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === costMonster.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: metalSlave.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned", "breakEffect", "counterAdded"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: costMonster.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: metalSlave.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: metalSlave.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: metalSlave.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [metalSlave.uid],
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: metalSlave.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: metalSlave.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: metalSlave.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Super B.E.S. Metal Slave");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_BES)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,1,5,aux.dncheck,1,tp,HINTMSG_TOGRAVE)");
  expect(script).toContain("e:SetLabel(Duel.SendtoGrave(sg,REASON_COST))");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,e:GetLabel(),tp,COUNTER_BES)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("c:AddCounter(COUNTER_BES,count)");
  expect(script).toContain("e2:SetCost(Cost.RemoveCounterFromSelf(COUNTER_BES,1))");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsCanBeEffectTarget,e),tp,LOCATION_ONFIELD,LOCATION_ONFIELD,nil)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,1,tp,HINTMSG_DESTROY)");
  expect(script).toContain("Duel.SetTargetCard(g)");
  expect(script).toContain("Duel.GetTargetCards(e)");
  expect(script).toContain("Duel.Destroy(tg,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: metalSlaveCode, name: "Super B.E.S. Metal Slave", kind: "monster", typeFlags: typeMonster | typeEffect, level: 10, attack: 3000, defense: 2500, setcodes: [setBes] },
    { code: costMonsterCode, name: "Metal Slave Cost B.E.S.", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000, setcodes: [setBes] },
    { code: targetMonsterCode, name: "Metal Slave Target B.E.S.", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000, setcodes: [setBes] },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
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
