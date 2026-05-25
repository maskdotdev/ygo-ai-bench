import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const archfiendCode = "50415441";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasArchfiendScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${archfiendCode}.lua`));
const typeMonster = 0x1;
const typeFlip = 0x10;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasArchfiendScript)("Lua real script Mimighoul Archfiend hand set summon", () => {
  it("restores hand ignition into opponent-field face-down Special Summon and confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${archfiendCode}.lua`);
    expect(script).toContain("--Mimighoul Archfiend");
    expect(script).toContain("e1:SetCategory(CATEGORY_DRAW+CATEGORY_TOGRAVE+CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("Duel.Draw(1-tp,1,REASON_EFFECT)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
    expect(script).toContain("Duel.GetControl(c,1-tp)");
    expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_SET)");
    expect(script).toContain("e2:SetRange(LOCATION_HAND)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,1-tp,false,false,POS_FACEDOWN_DEFENSE)");
    expect(script).toContain("Duel.ConfirmCards(tp,c)");
    expect(script).toContain("e3:SetCategory(CATEGORY_POSITION)");
    expect(script).toContain("Duel.SelectPosition(tp,tc,POS_FACEUP_ATTACK|POS_FACEUP_DEFENSE)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 50415441, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [archfiendCode] }, 1: { main: [] } });
    startDuel(session);

    const archfiend = requireCard(session, archfiendCode);
    archfiend.location = "hand";
    archfiend.controller = 0;
    archfiend.sequence = 0;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(archfiendCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === archfiend.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      {
        category: 73760,
        code: undefined,
        countLimit: 1,
        event: "trigger",
        property: undefined,
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        triggerEvent: "flipSummoned",
      },
      {
        category: 4294967808,
        code: undefined,
        countLimit: 1,
        event: "ignition",
        property: undefined,
        range: ["hand"],
        triggerEvent: undefined,
      },
      {
        category: 4096,
        code: 1100,
        countLimit: 1,
        event: "trigger",
        property: 65536,
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        triggerEvent: "normalSummoned",
      },
      {
        category: 4096,
        code: 1102,
        countLimit: 1,
        event: "trigger",
        property: 65536,
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        triggerEvent: "specialSummoned",
      },
    ]);

    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === archfiend.uid && action.effectId === "lua-2"
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, ignition!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? 0);
    passRestoredChain(restoredChain);

    const summoned = findCard(restoredChain.session, archfiend.uid);
    expect(summoned).toMatchObject({
      controller: 1,
      previousController: 0,
      location: "monsterZone",
      faceUp: false,
      position: "faceDownDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: archfiend.uid,
      reasonEffectId: 2,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["specialSummoned", "confirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      previousLocation: event.eventPreviousState?.location,
      currentController: event.eventCurrentState?.controller,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: archfiend.uid, eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: archfiend.uid, eventReasonEffectId: 2, previousController: 0, previousLocation: "hand", currentController: 1, currentLocation: "monsterZone" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: archfiend.uid, eventPlayer: 0, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: archfiend.uid, eventReasonEffectId: 2, previousController: 0, previousLocation: "hand", currentController: 1, currentLocation: "monsterZone" },
    ]);

    const restoredSummoned = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), workspace, reader);
    expectCleanRestore(restoredSummoned);
    expectRestoredLegalActions(restoredSummoned, restoredSummoned.session.state.waitingFor ?? restoredSummoned.session.state.turnPlayer);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: archfiendCode, name: "Mimighoul Archfiend", kind: "monster", typeFlags: typeMonster | typeFlip | typeEffect, level: 1, attack: 0, defense: 1900 },
  ];
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
