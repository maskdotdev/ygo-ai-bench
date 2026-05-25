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
const necrofearCode = "31829185";
const fiendACode = "318291850";
const fiendBCode = "318291851";
const fiendCCode = "318291852";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNecrofearScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${necrofearCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const attributeDark = 0x20;
const categoryControl = 0x2000;
const categoryEquip = 0x40000;
const categoryLeaveGrave = 0x1000000;
const effectFlagCannotDisable = 0x400;
const effectFlagCardTarget = 0x10;
const effectFlagUncopyable = 0x4000000;
const effectEquipLimit = 76;
const effectSetControl = 4;

describe.skipIf(!hasUpstreamScripts || !hasNecrofearScript)("Lua real script Dark Necrofear procedure equip", () => {
  it("restores its three-Fiend SpElimFilter banish procedure and registered grave equip-control trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${necrofearCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 31829185, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [necrofearCode, fiendACode, fiendBCode, fiendCCode] }, 1: { main: [] } });
    startDuel(session);

    const necrofear = requireCard(session, necrofearCode);
    const fiends = [requireCard(session, fiendACode), requireCard(session, fiendBCode), requireCard(session, fiendCCode)];
    moveDuelCard(session.state, necrofear.uid, "hand", 0);
    for (const [sequence, fiend] of fiends.entries()) moveDuelCard(session.state, fiend.uid, "graveyard", 0).sequence = sequence;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(necrofearCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === necrofear.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", property: 263168, range: ["hand"], triggerEvent: undefined },
      { category: undefined, code: 34, countLimit: undefined, event: "summonProcedure", property: 262144, range: ["hand"], triggerEvent: undefined },
      { category: undefined, code: 1014, countLimit: undefined, event: "continuous", property: effectFlagCannotDisable, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "sentToGraveyard" },
      { category: undefined, code: 4608, countLimit: 1, event: "trigger", property: effectFlagCardTarget, range: ["graveyard"], triggerEvent: "phaseEnd" },
    ]);
    const procedure = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === necrofear.uid,
    );
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, procedure!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === necrofear.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    for (const fiend of fiends) {
      expect(restoredOpen.session.state.cards.find((card) => card.uid === fiend.uid)).toMatchObject({
        location: "banished",
        controller: 0,
        faceUp: true,
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: necrofear.uid,
      });
    }
    const banishedEvents = restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }));
    expect(banishedEvents).toEqual(expect.arrayContaining(fiends.map((fiend) => ({
      eventName: "banished",
      eventCardUid: fiend.uid,
      eventReason: duelReason.cost,
      eventReasonPlayer: 0,
      eventReasonCardUid: necrofear.uid,
      previous: "graveyard",
      current: "banished",
    }))));
    expect(banishedEvents).toHaveLength(4);

    const restoredSummoned = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSummoned);
    expectRestoredLegalActions(restoredSummoned, restoredSummoned.session.state.waitingFor ?? restoredSummoned.session.state.turnPlayer);
    expect(restoredSummoned.session.state.effects.filter((effect) => effect.sourceUid === necrofear.uid).some((effect) => effect.code === effectEquipLimit || effect.code === effectSetControl)).toBe(false);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Dark Necrofear");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("return c:IsRace(RACE_FIEND) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,3,3,aux.ChkfMMZ(1),1,tp,HINTMSG_REMOVE)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("c:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,1,0,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_EQUIP,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.Equip(tp,c,tc)");
  expect(script).toContain("e1:SetCode(EFFECT_EQUIP_LIMIT)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_CONTROL)");
}

function cards(): DuelCardData[] {
  return [
    { code: necrofearCode, name: "Dark Necrofear", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 8, attack: 2200, defense: 2800 },
    { code: fiendACode, name: "Dark Necrofear Fiend A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: fiendBCode, name: "Dark Necrofear Fiend B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: fiendCCode, name: "Dark Necrofear Fiend C", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
