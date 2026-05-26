import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dancerCode = "69529337";
const graveTriamidCode = "695293370";
const rockCode = "695293371";
const currentFieldCode = "695293372";
const deckFieldCode = "695293373";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDancerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dancerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeField = 0x80000;
const raceRock = 0x100;
const attributeEarth = 0x1;
const setTriamid = 0xe2;

describe.skipIf(!hasUpstreamScripts || !hasDancerScript)("Lua real script Triamid Dancer to-Deck stat Field Spell", () => {
  it("restores grave Triamid target shuffle into Rock ATK/DEF gain", () => {
    const { workspace, source, reader, session } = createTriamidSession(69529337);
    const dancer = requireCard(session, dancerCode);
    const graveTriamid = requireCard(session, graveTriamidCode);
    const rock = requireCard(session, rockCode);
    moveFaceUpAttack(session, dancer, 0, 0);
    moveFaceUpAttack(session, rock, 0, 1);
    moveDuelCard(session.state, graveTriamid.uid, "graveyard", 0).faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(dancerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === dancer.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      targetDescriptor: effect.luaTargetDescriptor,
    }))).toEqual([
      { code: undefined, event: "ignition", id: "lua-1", targetDescriptor: undefined },
      { code: 1002, event: "quick", id: "lua-2-1002", targetDescriptor: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const statIgnition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === dancer.uid && action.effectId === "lua-1");
    expect(statIgnition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, statIgnition!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === graveTriamid.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: dancer.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === dancer.uid), restoredOpen.session.state)).toBe(1100);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === dancer.uid), restoredOpen.session.state)).toBe(2400);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === rock.uid), restoredOpen.session.state)).toBe(1700);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === rock.uid), restoredOpen.session.state)).toBe(1500);
    expect(restoredOpen.session.state.effects.filter((effect) => [dancer.uid, rock.uid].includes(effect.sourceUid) && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x400, reset: { flags: 33427456 }, sourceUid: dancer.uid, value: 500 },
      { code: 104, property: 0x400, reset: { flags: 33427456 }, sourceUid: dancer.uid, value: 500 },
      { code: 100, property: 0x400, reset: { flags: 33427456 }, sourceUid: rock.uid, value: 500 },
      { code: 104, property: 0x400, reset: { flags: 33427456 }, sourceUid: rock.uid, value: 500 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: graveTriamid.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: dancer.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "deck" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores opponent-turn Field Spell replacement legality", () => {
    const { workspace, source, reader, session } = createTriamidSession(69529338);
    const dancer = requireCard(session, dancerCode);
    const currentField = requireCard(session, currentFieldCode);
    const deckField = requireCard(session, deckFieldCode);
    moveFaceUpAttack(session, dancer, 0, 0);
    moveDuelCard(session.state, currentField.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, deckField.uid, "deck", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(dancerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(deckFieldCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const replaceField = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === dancer.uid && action.effectId === "lua-2-1002");
    expect(replaceField, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(replaceField).toMatchObject({ type: "activateEffect", uid: dancer.uid, effectId: "lua-2-1002", player: 0, windowKind: "open" });
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createTriamidSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${dancerCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [dancerCode, graveTriamidCode, rockCode, currentFieldCode, deckFieldCode] },
    1: { main: [] },
  });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${deckFieldCode}.lua`) return fieldSpellScript();
      return workspace.readScript(name);
    },
  };
  return { workspace, source, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Triamid Dancer");
  expect(script).toContain("e1:SetCategory(CATEGORY_TODECK+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tdfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsRace,RACE_ROCK),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOGRAVE)");
  expect(script).toContain("Duel.IsTurnPlayer(1-tp)");
  expect(script).toContain("Duel.GetFieldCard(tp,LOCATION_FZONE,0)");
  expect(script).toContain("Duel.SetTargetCard(tc)");
  expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT)");
  expect(script).toContain("Duel.ActivateFieldSpell(fc,e,tp,eg,ep,ev,re,r,rp)");
}

function cards(): DuelCardData[] {
  return [
    { code: dancerCode, name: "Triamid Dancer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 3, attack: 600, defense: 1900, setcodes: [setTriamid] },
    { code: graveTriamidCode, name: "Triamid Fixture Grave Card", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000, setcodes: [setTriamid] },
    { code: rockCode, name: "Triamid Fixture Rock", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: currentFieldCode, name: "Triamid Fixture Current Field", kind: "spell", typeFlags: typeSpell | typeField, setcodes: [setTriamid] },
    { code: deckFieldCode, name: "Triamid Fixture Deck Field", kind: "spell", typeFlags: typeSpell | typeField, setcodes: [setTriamid] },
  ];
}

function fieldSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
