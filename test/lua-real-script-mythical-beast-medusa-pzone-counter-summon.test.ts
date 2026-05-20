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
const medusaCode = "54965929";
const reviveCode = "549659291";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMedusaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${medusaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const counterSpell = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasMedusaScript)("Lua real script Mythical Beast Medusa PZONE counter summon", () => {
  it("restores Pendulum-zone self-destroy into Graveyard Special Summon and Spell Counter placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${medusaCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
    expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
    expect(script).toContain("return Duel.GetFieldGroupCount(tp,LOCATION_PZONE,0) == 1");
    expect(script).toContain("return c:IsCanAddCounter(COUNTER_SPELL,1,false,LOCATION_MZONE) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("tc:AddCounter(COUNTER_SPELL,1)");

    const cards: DuelCardData[] = [
      { code: medusaCode, name: "Mythical Beast Medusa", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, level: 4, attack: 1500, defense: 1500, leftScale: 4, rightScale: 4 },
      { code: reviveCode, name: "Medusa Spell Counter Revive", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 54965929, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [medusaCode, reviveCode] }, 1: { main: [] } });
    startDuel(session);

    const medusa = requireCard(session, medusaCode);
    const revive = requireCard(session, reviveCode);
    moveDuelCard(session.state, medusa.uid, "spellTrapZone", 0).sequence = 0;
    medusa.faceUp = true;
    medusa.position = "faceUpAttack";
    moveDuelCard(session.state, revive.uid, "graveyard", 0);
    revive.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${reviveCode}.lua`) return spellCounterReviveScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(medusaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(reviveCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === medusa.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(action).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredOpen, action!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === medusa.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: medusa.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === revive.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: medusa.uid,
      reasonEffectId: 4,
    });
    expect(getDuelCardCounter(restoredOpen.session.state.cards.find((card) => card.uid === revive.uid), counterSpell)).toBe(1);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "specialSummoned", "counterAdded"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: revive.uid,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: medusa.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: medusa.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: revive.uid,
        eventUids: [revive.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: medusa.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "counterAdded",
        eventCode: 65536,
        eventCardUid: revive.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: medusa.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function spellCounterReviveScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      c:EnableCounterPermit(COUNTER_SPELL)
    end
  `;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
