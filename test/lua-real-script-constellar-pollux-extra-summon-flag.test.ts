import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import {
  applyLuaRestoreResponse,
  getLuaRestoreLegalActionGroups,
  getLuaRestoreLegalActions,
  restoreDuelWithLuaScripts,
} from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const polluxCode = "78364470";
const hasPolluxScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${polluxCode}.lua`));
const constellarTargetCode = "78364471";
const offArchetypeCode = "78364472";
const setConstellar = 0x53;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasPolluxScript)("Lua real script Constellar Pollux extra summon flag", () => {
  it("restores its summon-success Constellar-only extra Normal Summon and once-per-turn flag", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${polluxCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("if Duel.GetFlagEffect(tp,id)~=0 then return end");
    expect(script).toContain("e1:SetCode(EFFECT_EXTRA_SUMMON_COUNT)");
    expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_CONSTELLAR))");
    expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");

    const cards: DuelCardData[] = [
      {
        code: polluxCode,
        name: "Constellar Pollux",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        setcodes: [setConstellar],
        level: 4,
        attack: 1700,
        defense: 600,
      },
      {
        code: constellarTargetCode,
        name: "Constellar Flag Probe",
        kind: "monster",
        typeFlags: typeMonster,
        setcodes: [setConstellar],
        level: 4,
        attack: 1400,
        defense: 1000,
      },
      {
        code: offArchetypeCode,
        name: "Off-Archetype Normal Probe",
        kind: "monster",
        typeFlags: typeMonster,
        setcodes: [0x999],
        level: 4,
        attack: 1400,
        defense: 1000,
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 783, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polluxCode, polluxCode, constellarTargetCode, offArchetypeCode] }, 1: { main: [] } });
    startDuel(session);

    const polluxCopies = session.state.cards.filter((card) => card.code === polluxCode);
    expect(polluxCopies).toHaveLength(2);
    const firstPollux = polluxCopies[0]!;
    const secondPollux = polluxCopies[1]!;
    const constellarTarget = requireCard(session, constellarTargetCode);
    const offArchetype = requireCard(session, offArchetypeCode);
    for (const card of [firstPollux, secondPollux, constellarTarget, offArchetype]) {
      moveDuelCard(session.state, card.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(polluxCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const firstSummon = findNormalSummon(session, firstPollux.uid);
    applyAndAssert(session, firstSummon);
    expect(session.state.players[0].normalSummonAvailable).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    expect(host.messages).not.toContain("unsupported");

    const restoredActions = getLuaRestoreLegalActions(restored, 0);
    expect(restoredActions.find((action) => action.type === "normalSummon" && action.uid === secondPollux.uid)).toBeDefined();
    expect(restoredActions.find((action) => action.type === "normalSummon" && action.uid === constellarTarget.uid)).toBeDefined();
    expect(restoredActions.find((action) => action.type === "normalSummon" && action.uid === offArchetype.uid)).toBeUndefined();

    const secondSummon = restoredActions.find((action) => action.type === "normalSummon" && action.uid === secondPollux.uid);
    expect(secondSummon, JSON.stringify(restoredActions, null, 2)).toBeDefined();
    const summoned = applyLuaRestoreResponse(restored, secondSummon!);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(summoned.legalActions).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(summoned.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, 0));
    expect(summoned.legalActionGroups.flatMap((group) => group.actions)).toEqual(summoned.legalActions);

    expect(restored.session.state.cards.find((card) => card.uid === secondPollux.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "normal",
    });
    expect(restored.session.state.activityCounts[0].normalSummon).toBe(2);
    expect(getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "normalSummon" && action.uid === constellarTarget.uid)).toBeUndefined();
    expect(getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "normalSummon" && action.uid === offArchetype.uid)).toBeUndefined();
    expect(host.messages).not.toContain("unsupported");

    const probeHost = createLuaScriptHost(restored.session, workspace);
    const probe = probeHost.loadScript(
      `
      local flag = Duel.GetFlagEffect(0, ${polluxCode})
      Debug.Message("pollux extra flag " .. flag)
    `,
      "pollux-flag-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(probeHost.messages).toEqual(["pollux extra flag 1"]);
    expect(probeHost.messages).not.toContain("unsupported");

    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: firstPollux.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: secondPollux.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findNormalSummon(session: DuelSession, uid: string): DuelAction {
  const action = getLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === uid);
  expect(action, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
  return action!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
