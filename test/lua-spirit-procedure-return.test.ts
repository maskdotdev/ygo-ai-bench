import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelSession } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const spiritCode = "910001";
const doNotReturnCode = "910002";
const mayNotReturnCode = "910003";

describe("Lua Spirit procedure return modifiers", () => {
  it("requires a registered Spirit return event before the End Phase return trigger", () => {
    const setup = setupSpiritProcedureDuel([spiritCode]);
    const spirit = setup.session.state.cards.find((card) => card.code === spiritCode);
    expect(spirit).toBeDefined();
    moveDuelCard(setup.session.state, spirit!.uid, "monsterZone", 0);
    spirit!.faceUp = true;
    spirit!.position = "faceUpAttack";
    setup.session.state.phase = "main1";
    setup.session.state.waitingFor = 0;
    loadScripts(setup.session, setup.source, [spiritCode]);

    advanceToEndPhase(setup.session);

    expect(setup.session.state.pendingTriggers).toEqual([]);
    expect(getLegalActions(setup.session, 0).some((action) => action.type === "activateTrigger" && action.uid === spirit!.uid)).toBe(false);
    const restored = restoreDuelWithLuaScripts(serializeDuel(setup.session), setup.source, setup.reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateTrigger" && action.uid === spirit!.uid)).toBe(false);
  });

  it("suppresses the End Phase return trigger while EFFECT_SPIRIT_DONOT_RETURN applies", () => {
    const setup = setupSpiritProcedureDuel([spiritCode, doNotReturnCode]);
    const spirit = setup.session.state.cards.find((card) => card.code === spiritCode);
    const doNotReturn = setup.session.state.cards.find((card) => card.code === doNotReturnCode);
    expect(spirit).toBeDefined();
    expect(doNotReturn).toBeDefined();
    moveDuelCard(setup.session.state, spirit!.uid, "hand", 0);
    moveDuelCard(setup.session.state, doNotReturn!.uid, "spellTrapZone", 0);
    doNotReturn!.faceUp = true;
    doNotReturn!.position = "faceUpAttack";
    setup.session.state.phase = "main1";
    setup.session.state.waitingFor = 0;
    loadScripts(setup.session, setup.source, [spiritCode, doNotReturnCode]);

    normalSummon(setup.session, spirit!.uid);
    advanceToEndPhase(setup.session);

    expect(setup.session.state.pendingTriggers).toEqual([]);
    expect(setup.session.state.cards.find((card) => card.uid === spirit!.uid)).toMatchObject({ location: "monsterZone" });
    const restored = restoreDuelWithLuaScripts(serializeDuel(setup.session), setup.source, setup.reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateTrigger" && action.uid === spirit!.uid)).toBe(false);
    expect(restored.session.state.cards.find((card) => card.uid === spirit!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("restores optional Spirit return choices while EFFECT_SPIRIT_MAYNOT_RETURN applies", () => {
    const setup = setupSpiritProcedureDuel([spiritCode, mayNotReturnCode]);
    const spirit = setup.session.state.cards.find((card) => card.code === spiritCode);
    const mayNotReturn = setup.session.state.cards.find((card) => card.code === mayNotReturnCode);
    expect(spirit).toBeDefined();
    expect(mayNotReturn).toBeDefined();
    moveDuelCard(setup.session.state, spirit!.uid, "hand", 0);
    moveDuelCard(setup.session.state, mayNotReturn!.uid, "monsterZone", 0);
    mayNotReturn!.faceUp = true;
    mayNotReturn!.position = "faceUpAttack";
    setup.session.state.phase = "main1";
    setup.session.state.waitingFor = 0;
    loadScripts(setup.session, setup.source, [spiritCode, mayNotReturnCode]);

    normalSummon(setup.session, spirit!.uid);
    advanceToEndPhase(setup.session);

    const snapshot = serializeDuel(setup.session);
    const restoredDecline = restoreDuelWithLuaScripts(snapshot, setup.source, setup.reader);
    expect(restoredDecline.restoreComplete, restoredDecline.incompleteReasons.join("; ")).toBe(true);
    const decline = getLuaRestoreLegalActions(restoredDecline, 0).find((action) => action.type === "declineTrigger" && action.uid === spirit!.uid);
    expect(decline, JSON.stringify(getLuaRestoreLegalActions(restoredDecline, 0), null, 2)).toBeDefined();
    const declined = applyLuaRestoreResponse(restoredDecline, decline!);
    expect(declined.ok, declined.error).toBe(true);
    expect(restoredDecline.session.state.cards.find((card) => card.uid === spirit!.uid)).toMatchObject({ location: "monsterZone" });

    const restoredActivate = restoreDuelWithLuaScripts(snapshot, setup.source, setup.reader);
    expect(restoredActivate.restoreComplete, restoredActivate.incompleteReasons.join("; ")).toBe(true);
    const activate = getLuaRestoreLegalActions(restoredActivate, 0).find((action) => action.type === "activateTrigger" && action.uid === spirit!.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivate, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restoredActivate, activate!);
    expect(activated.ok, activated.error).toBe(true);
    resolveRestoredChain(restoredActivate, spirit!.uid);
    expect(restoredActivate.session.state.cards.find((card) => card.uid === spirit!.uid)).toMatchObject({ location: "hand", controller: 0 });
  });
});

function setupSpiritProcedureDuel(main: string[]) {
  const cards = [
    { code: spiritCode, name: "Spirit Return Fixture", kind: "monster" as const, typeFlags: 0x200001, level: 4, attack: 1800, defense: 1200 },
    { code: doNotReturnCode, name: "Spirit Do Not Return Fixture", kind: "spell" as const, typeFlags: 0x10002 },
    { code: mayNotReturnCode, name: "Spirit May Not Return Fixture", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 910, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main }, 1: { main: [] } });
  startDuel(session);
  return { reader, session, source: spiritScriptSource() };
}

function loadScripts(session: DuelSession, source: ReturnType<typeof spiritScriptSource>, codes: string[]): void {
  const host = createLuaScriptHost(session, source);
  for (const code of codes) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(codes.length);
}

function spiritScriptSource() {
  return {
    readScript(name: string) {
      if (name === `c${spiritCode}.lua`) return spiritProcedureScript();
      if (name === `c${doNotReturnCode}.lua`) return spiritDoNotReturnScript();
      if (name === `c${mayNotReturnCode}.lua`) return spiritMayNotReturnScript();
      return undefined;
    },
  };
}

function normalSummon(session: DuelSession, uid: string): void {
  const action = getLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === uid);
  expect(action, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
  applyAndAssert(session, action!);
}

function advanceToEndPhase(session: DuelSession): void {
  for (const phase of ["battle", "main2", "end"] as const) {
    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
    expect(action, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, action!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, sourceUid: string): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const passed = applyLuaRestoreResponse(restored, pass!);
    expect(passed.ok, passed.error).toBe(true);
  }
  expect(restored.session.state.cards.find((card) => card.uid === sourceUid)).toBeDefined();
}

function spiritProcedureScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      Spirit.AddProcedure(c,EVENT_SUMMON_SUCCESS,EVENT_FLIP)
    end
  `;
}

function spiritDoNotReturnScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_SPIRIT_DONOT_RETURN)
      e:SetRange(LOCATION_SZONE)
      e:SetTargetRange(LOCATION_MZONE,LOCATION_MZONE)
      c:RegisterEffect(e)
    end
  `;
}

function spiritMayNotReturnScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_SPIRIT_MAYNOT_RETURN)
      e:SetRange(LOCATION_MZONE)
      e:SetTargetRange(LOCATION_MZONE,0)
      c:RegisterEffect(e)
    end
  `;
}
