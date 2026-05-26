import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, getLuaRestoreLegalActionGroups, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const leadYokeCode = "23232295";
const hasLeadYokeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${leadYokeCode}.lua`));
const materialACode = "232322951";
const materialBCode = "232322952";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const setBattlinBoxer = 0x84;

describe.skipIf(!hasUpstreamScripts || !hasLeadYokeScript)("Lua real script Battlin' Boxer Lead Yoke detach replacement stat", () => {
  it("restores destroy replacement into detach-material ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${leadYokeCode}.lua`);
    expect(script).toContain("Duel.EnableGlobalFlag(GLOBALFLAG_DETACH_EVENT)");
    expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_BATTLIN_BOXER),4,2)");
    expect(script).toContain("e1:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
    expect(script).toContain("e:GetHandler():RemoveOverlayCard(tp,1,1,REASON_EFFECT)");
    expect(script).toContain("e2:SetCode(EVENT_DETACH_MATERIAL)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(800)");

    const cards: DuelCardData[] = [
      { code: leadYokeCode, name: "Battlin' Boxer Lead Yoke", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, setcodes: [setBattlinBoxer], level: 4, attack: 2200, defense: 2000 },
      { code: materialACode, name: "Battlin' Boxer Lead Yoke Material A", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBattlinBoxer], level: 4, attack: 1000, defense: 1000 },
      { code: materialBCode, name: "Battlin' Boxer Lead Yoke Material B", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBattlinBoxer], level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 23232295, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode], extra: [leadYokeCode] }, 1: { main: [] } });
    startDuel(session);

    const leadYoke = requireCard(session, leadYokeCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    moveDuelCard(session.state, leadYoke.uid, "monsterZone", 0);
    leadYoke.faceUp = true;
    leadYoke.position = "faceUpAttack";
    leadYoke.summonType = "xyz";
    for (const [sequence, material] of [materialA, materialB].entries()) {
      moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = sequence;
      leadYoke.overlayUids.push(material.uid);
    }
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leadYokeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === leadYoke.uid), restoredOpen.session.state)).toBe(2200);

    const destroyed = destroyDuelCard(restoredOpen.session.state, leadYoke.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(destroyed).toMatchObject({
      uid: leadYoke.uid,
      location: "monsterZone",
      overlayUids: [materialB.uid],
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: leadYoke.uid,
    });

    const restoredAfterReplacement = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAfterReplacement);
    expectRestoredLegalActions(restoredAfterReplacement, 0);
    const attackTrigger = getLuaRestoreLegalActions(restoredAfterReplacement, 0).find((action) => action.type === "activateTrigger" && action.uid === leadYoke.uid);
    expect(attackTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAfterReplacement, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAfterReplacement, attackTrigger!);
    resolveRestoredChain(restoredAfterReplacement);

    expect(currentAttack(restoredAfterReplacement.session.state.cards.find((card) => card.uid === leadYoke.uid), restoredAfterReplacement.session.state)).toBe(3000);
    expect(restoredAfterReplacement.session.state.effects.filter((effect) => effect.sourceUid === leadYoke.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x2000, reset: { flags: 33492992 }, sourceUid: leadYoke.uid, value: 800 },
    ]);
    expect(restoredAfterReplacement.session.state.cards.find((card) => card.uid === leadYoke.uid)?.overlayUids).toEqual([materialB.uid]);
    expect(restoredAfterReplacement.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial")).toEqual([
      {
        eventName: "detachedMaterial",
        eventCardUid: materialA.uid,
        eventCode: 1202,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: leadYoke.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "overlay",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restoredAfterReplacement.session.state.eventHistory.filter((event) => event.eventName === "chainSolved")).toEqual([
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-4",
      },
    ]);

    const restoredAfterAttackGain = restoreDuelWithLuaScripts(serializeDuel(restoredAfterReplacement.session), workspace, reader);
    expectCleanRestore(restoredAfterAttackGain);
    expectRestoredLegalActions(restoredAfterAttackGain, 0);
    expect(currentAttack(restoredAfterAttackGain.session.state.cards.find((card) => card.uid === leadYoke.uid), restoredAfterAttackGain.session.state)).toBe(3000);
    expect(restoredAfterAttackGain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response).toMatchObject({ ok: true });
  return response;
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>) {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => (candidate as { type: string }).type === "resolveChain");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    guard += 1;
    expect(guard).toBeLessThan(10);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>) {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1) {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
