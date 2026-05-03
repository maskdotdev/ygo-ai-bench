import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, type LuaSnapshotRestoreResult, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua summon-negated events", () => {
  it("queues summon-negated triggers when Duel.NegateSummon negates a Normal Summon", () => {
    const fixture = createNegatedSummonFixture(198, "EVENT_SUMMON_NEGATED", "normal summon negated");
    const summon = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === fixture.summoned.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(fixture.session, summon!).ok).toBe(true);
    fixture.session.state.pendingTriggers = [];

    activateNegator(fixture);

    expect(fixture.host.messages).toContain("negated count 1");
    expect(fixture.session.state.cards.find((card) => card.uid === fixture.summoned.uid)).toMatchObject({ location: "graveyard" });
    expect(fixture.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["normalSummonNegated"]);
    expect(fixture.session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: fixture.summoned.uid });
    assertRestoredNegatedTrigger(fixture, "normal summon negated 100");
  });

  it("queues flip-summon-negated triggers when Duel.NegateSummon negates a Flip Summon", () => {
    const fixture = createNegatedSummonFixture(199, "EVENT_FLIP_SUMMON_NEGATED", "flip summon negated");
    moveDuelCard(fixture.session.state, fixture.summoned.uid, "monsterZone", 0).position = "faceDownDefense";
    fixture.summoned.faceUp = false;
    const flip = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === fixture.summoned.uid);
    expect(flip).toBeDefined();
    expect(applyResponse(fixture.session, flip!).ok).toBe(true);
    fixture.session.state.pendingTriggers = [];

    activateNegator(fixture);

    expect(fixture.host.messages).toContain("negated count 1");
    expect(fixture.session.state.cards.find((card) => card.uid === fixture.summoned.uid)).toMatchObject({ location: "graveyard" });
    expect(fixture.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummonNegated"]);
    expect(fixture.session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: fixture.summoned.uid });
    assertRestoredNegatedTrigger(fixture, "flip summon negated 100");
  });

  it("queues special-summon-negated triggers when Duel.NegateSummon negates a Special Summon", () => {
    const fixture = createNegatedSummonFixture(197, "EVENT_SPSUMMON_NEGATED", "special summon negated");
    specialSummonDuelCard(fixture.session.state, fixture.summoned.uid, 0);
    fixture.session.state.pendingTriggers = [];

    activateNegator(fixture);

    expect(fixture.host.messages).toContain("negated count 1");
    expect(fixture.session.state.cards.find((card) => card.uid === fixture.summoned.uid)).toMatchObject({ location: "graveyard" });
    expect(fixture.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["specialSummonNegated"]);
    expect(fixture.session.state.pendingTriggers[0]).toMatchObject({ eventCardUid: fixture.summoned.uid });
    expect(fixture.session.state.eventHistory.map((event) => event.eventName).slice(-2)).toEqual(["specialSummonNegated", "chainSolved"]);
    assertRestoredNegatedTrigger(fixture, "special summon negated 100");
  });
});

interface NegatedSummonFixture {
  cards: DuelCardData[];
  host: ReturnType<typeof createLuaScriptHost>;
  scriptSource: { readScript(name: string): string | undefined };
  session: ReturnType<typeof createDuel>;
  summoned: NonNullable<ReturnType<ReturnType<typeof createDuel>["state"]["cards"]["find"]>>;
}

function createNegatedSummonFixture(seed: number, eventCode: string, message: string): NegatedSummonFixture {
  const cards: DuelCardData[] = [
    { code: "100", name: "Negated Summon", kind: "monster" },
    { code: "200", name: "Summon Negator", kind: "monster" },
    { code: "300", name: "Negation Watcher", kind: "monster" },
  ];
  const session = createDuel({ seed, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "200", "300"] },
    1: { main: [] },
  });
  startDuel(session);
  const summoned = session.state.cards.find((card) => card.code === "100");
  expect(summoned).toBeDefined();

  const scriptSource = {
    readScript(name: string) {
      if (name === "c200.lua") {
        return `
    c200={}
    function c200.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        local g=Duel.GetMatchingGroup(aux.TRUE,tp,LOCATION_MZONE,0,nil)
        Debug.Message("negated count " .. Duel.NegateSummon(g:GetFirst()))
      end)
      c:RegisterEffect(e)
    end
    `;
      }
      if (name === "c300.lua") {
        return `
    c300={}
    function c300.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(${eventCode})
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg)
        Debug.Message("${message} " .. eg:GetFirst():GetCode())
      end)
      c:RegisterEffect(e)
    end
    `;
      }
      return undefined;
    },
  };
  const host = createLuaScriptHost(session);
  const negatorScript = host.loadCardScript(200, scriptSource);
  const watcherScript = host.loadCardScript(300, scriptSource);
  expect(negatorScript.ok, negatorScript.error).toBe(true);
  expect(watcherScript.ok, watcherScript.error).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return { cards, host, scriptSource, session, summoned: summoned! };
}

function activateNegator(fixture: { session: ReturnType<typeof createDuel> }): void {
  const action = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("200"));
  expect(action).toBeDefined();
  expect(applyResponse(fixture.session, action!).ok).toBe(true);
}

function assertRestoredNegatedTrigger(fixture: NegatedSummonFixture, message: string): void {
  const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.scriptSource, createCardReader(fixture.cards));
  expect(restored.restoreComplete).toBe(true);
  expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c200.lua", "c300.lua"]);
  expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
  expect(restored.session.state.pendingTriggers).toEqual(fixture.session.state.pendingTriggers);
  expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
  const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
  expect(trigger).toBeDefined();
  expect(applyLuaRestoreResponse(restored, trigger!).ok).toBe(true);
  drainRestoredChain(restored);
  expect(restored.host.messages).toContain(message);
}

function drainRestoredChain(restored: LuaSnapshotRestoreResult): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(applyLuaRestoreResponse(restored, pass!).ok).toBe(true);
  }
}
