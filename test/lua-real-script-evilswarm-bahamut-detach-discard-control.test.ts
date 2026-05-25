import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const bahamutCode = "36757171";
const materialCode = "367571710";
const discardCode = "367571711";
const targetCode = "367571712";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBahamutScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bahamutCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const setLswarm = 0xa;
const categoryHandes = 0x80;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasBahamutScript)("Lua real script Evilswarm Bahamut detach discard control", () => {
  it("restores detach cost into lswarm hand discard and targeted control take", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${bahamutCode}.lua`);
    expect(script).toContain("--Evilswarm Bahamut");
    expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_LSWARM),4,2)");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL+CATEGORY_HANDES)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,tp,1)");
    expect(script).toContain("return c:IsSetCard(SET_LSWARM) and c:IsMonster() and c:IsDiscardable()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.dfilter,tp,LOCATION_HAND,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT|REASON_DISCARD)");
    expect(script).toContain("Duel.GetControl(tc,tp)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 36757171, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [discardCode, materialCode], extra: [bahamutCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const bahamut = requireCard(session, bahamutCode);
    const material = requireCard(session, materialCode);
    const discard = requireCard(session, discardCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, bahamut, 0, 0);
    bahamut.summonType = "xyz";
    const overlay = moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    overlay.sequence = 0;
    bahamut.overlayUids.push(overlay.uid);
    moveDuelCard(session.state, discard.uid, "hand", 0);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bahamutCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === bahamut.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      {
        category: undefined,
        code: 31,
        countLimit: undefined,
        event: "continuous",
        property: 263168,
        range: ["monsterZone"],
      },
      {
        category: categoryControl | categoryHandes,
        code: undefined,
        countLimit: 1,
        event: "ignition",
        property: effectFlagCardTarget,
        range: ["monsterZone"],
      },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === bahamut.uid && action.effectId === "lua-2"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, activation!);

    expect(findCard(restoredOpen.session, material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: bahamut.uid,
      reasonEffectId: 2,
    });
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? 0);
    passRestoredChain(restoredChain);

    expect(findCard(restoredChain.session, discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: bahamut.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restoredChain.session, target.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: bahamut.uid,
      reasonEffectId: 2,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["detachedMaterial", "becameTarget", "discarded", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      previousLocation: event.eventPreviousState?.location,
      currentController: event.eventCurrentState?.controller,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: bahamut.uid, eventReasonEffectId: 2, previousController: 0, previousLocation: "overlay", currentController: 0, currentLocation: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousController: 1, previousLocation: "deck", currentController: 1, currentLocation: "monsterZone" },
      { eventName: "discarded", eventCode: 1018, eventCardUid: discard.uid, eventReason: duelReason.effect | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: bahamut.uid, eventReasonEffectId: 2, previousController: 0, previousLocation: "hand", currentController: 0, currentLocation: "graveyard" },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: bahamut.uid, eventReasonEffectId: 2, previousController: 1, previousLocation: "monsterZone", currentController: 0, currentLocation: "monsterZone" },
    ]);

    const restoredControlled = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), workspace, reader);
    expectCleanRestore(restoredControlled);
    expectRestoredLegalActions(restoredControlled, restoredControlled.session.state.waitingFor ?? restoredControlled.session.state.turnPlayer);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: bahamutCode, name: "Evilswarm Bahamut", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, setcodes: [setLswarm], level: 4, attack: 2350, defense: 1350 },
    { code: materialCode, name: "Evilswarm Bahamut Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setLswarm], level: 4, attack: 1600, defense: 1000 },
    { code: discardCode, name: "Evilswarm Bahamut Discard", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setLswarm], level: 4, attack: 1500, defense: 1000 },
    { code: targetCode, name: "Evilswarm Bahamut Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
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
