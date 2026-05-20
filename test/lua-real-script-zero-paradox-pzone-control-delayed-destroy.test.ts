import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const zeroParadoxCode = "97417863";
const opponentScaleCode = "974178631";
const penEffectId = 5;
const typeMonster = 0x1;
const typePendulum = 0x1000000;
const pendulumMonsterType = typeMonster | typePendulum;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Zero Paradox Pendulum control", () => {
  it("restores PZone self summon, opponent scale MoveToField, flag, and delayed destroy registration", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${zeroParadoxCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToChangeControler,tp,0,LOCATION_PZONE,1,1,nil)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,true,true,POS_FACEUP)");
    expect(script).toContain("Duel.CheckPendulumZones(tp)");
    expect(script).toContain("Duel.MoveToField(tc,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");
    expect(script).toContain("tc:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,0,1)");
    expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("e1:SetLabel(Duel.GetTurnCount())");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === zeroParadoxCode),
      { code: opponentScaleCode, name: "Zero Paradox Opponent Scale", kind: "monster", typeFlags: pendulumMonsterType, level: 4, leftScale: 2, rightScale: 2, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 97417863, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zeroParadoxCode] }, 1: { main: [opponentScaleCode] } });
    startDuel(session);

    const zeroParadox = requireCard(session, zeroParadoxCode);
    const opponentScale = requireCard(session, opponentScaleCode);
    moveDuelCard(session.state, zeroParadox.uid, "spellTrapZone", 0).sequence = 0;
    const scale = moveDuelCard(session.state, opponentScale.uid, "spellTrapZone", 1);
    scale.sequence = 0;
    scale.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zeroParadoxCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).not.toContain("unsupported");

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.find((effect) => effect.id === "lua-5")).toMatchObject({
      luaTargetDescriptor: "target:select-opponent-pzone-able-control",
    });
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === zeroParadox.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === zeroParadox.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: zeroParadox.uid,
      reasonEffectId: penEffectId,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentScale.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: zeroParadox.uid,
      reasonEffectId: penEffectId,
    });
    expect(restoredOpen.session.state.flagEffects.filter((flag) => flag.ownerId === opponentScale.uid)).toEqual([
      { ownerType: "card", ownerId: opponentScale.uid, code: Number(zeroParadoxCode), reset: 33427456, property: 0, resetCount: 1, value: 0, turn: 1 },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === zeroParadox.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      label: effect.label,
      labelObjectUid: effect.labelObjectUid,
    }))).toEqual([
      { code: 320, event: "continuous", range: ["spellTrapZone"], reset: undefined, label: undefined, labelObjectUid: undefined },
      { code: 1002, event: "ignition", range: ["hand"], reset: undefined, label: undefined, labelObjectUid: undefined },
      { code: 31, event: "continuous", range: ["spellTrapZone"], reset: undefined, label: undefined, labelObjectUid: undefined },
      { code: 30, event: "continuous", range: ["spellTrapZone"], reset: undefined, label: undefined, labelObjectUid: undefined },
      { code: undefined, event: "ignition", range: ["spellTrapZone"], reset: undefined, label: undefined, labelObjectUid: undefined },
      { code: 1102, event: "trigger", range: ["hand"], reset: undefined, label: undefined, labelObjectUid: undefined },
      { code: 1015, event: "trigger", range: ["monsterZone"], reset: undefined, label: undefined, labelObjectUid: undefined },
      { code: 4608, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 1073742336, count: 2 }, label: 1, labelObjectUid: opponentScale.uid },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["specialSummoned", "controlChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: zeroParadox.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: zeroParadox.uid,
        eventReasonEffectId: penEffectId,
        eventUids: [zeroParadox.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: opponentScale.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: zeroParadox.uid,
        eventReasonEffectId: penEffectId,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function requireCard(session: DuelSession, code: string) {
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
