import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const seraphCode = "67173574";
const hasSeraphScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${seraphCode}.lua`));
const number102Code = "49678559";
const extraMaterialCode = "671735740";
const thirdMaterialCode = "671735741";
const targetCode = "671735742";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasSeraphScript)("Lua real script Number C102 Archfiend Seraph detach disable burn", () => {
  it("restores destroy replacement, detach-material burn, and target ATK-zero disable", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${seraphCode}.lua`);
    expect(script).toContain("Duel.EnableGlobalFlag(GLOBALFLAG_DETACH_EVENT)");
    expect(script).toContain("e1:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
    expect(script).toContain("c:RemoveOverlayCard(tp,2,2,REASON_EFFECT)");
    expect(script).toContain("e2:SetCode(EVENT_DETACH_MATERIAL)");
    expect(script).toContain("return e:GetHandler():GetOverlayCount()==0");
    expect(script).toContain("e3:SetCost(Cost.DetachFromSelf(1))");
    expect(script).toContain("return e:GetHandler():GetOverlayGroup():IsExists(Card.IsCode,1,nil,49678559)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e3:SetCode(EFFECT_DISABLE_EFFECT)");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: seraphCode, name: "Number C102: Archfiend Seraph", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 5, attack: 2900, defense: 2400 },
      { code: number102Code, name: "Number 102: Star Seraph Sentry", kind: "monster", typeFlags: typeMonster | typeEffect | typeXyz, level: 4, attack: 2500, defense: 2000 },
      { code: extraMaterialCode, name: "Archfiend Seraph Extra Material", kind: "monster", typeFlags: typeMonster, level: 5, attack: 1000, defense: 1000 },
      { code: thirdMaterialCode, name: "Archfiend Seraph Third Material", kind: "monster", typeFlags: typeMonster, level: 5, attack: 1000, defense: 1000 },
      { code: targetCode, name: "Archfiend Seraph Disable Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 67173574, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [number102Code, extraMaterialCode, thirdMaterialCode], extra: [seraphCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const seraph = requireCard(session, seraphCode);
    const number102 = requireCard(session, number102Code);
    const extraMaterial = requireCard(session, extraMaterialCode);
    const thirdMaterial = requireCard(session, thirdMaterialCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, seraph.uid, "monsterZone", 0).position = "faceUpAttack";
    seraph.faceUp = true;
    seraph.summonType = "xyz";
    for (const [sequence, material] of [extraMaterial, thirdMaterial, number102].entries()) {
      moveDuelCard(session.state, material.uid, "overlay", 0).sequence = sequence;
      seraph.overlayUids.push(material.uid);
    }
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    target.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(seraphCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const destroyed = destroyDuelCard(restoredOpen.session.state, seraph.uid, 0, duelReason.effect | duelReason.destroy, 1, "graveyard", {
      eventReasonCardUid: target.uid,
      eventReasonEffectId: 7,
    });
    expect(destroyed).toMatchObject({
      uid: seraph.uid,
      location: "monsterZone",
      overlayUids: [number102.uid],
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === extraMaterial.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: seraph.uid,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === thirdMaterial.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: seraph.uid,
    });
    expect(restoredOpen.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        api: "SelectEffectYesNo",
        player: 0,
        description: 96,
        returned: true,
      }),
    ]));

    const restoredAfterReplacement = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAfterReplacement);
    expectRestoredLegalActions(restoredAfterReplacement, 0);
    const activateSeraph = getLuaRestoreLegalActions(restoredAfterReplacement, 0).find((action) =>
      action.type === "activateEffect" && action.uid === seraph.uid
    );
    expect(activateSeraph, JSON.stringify(getLuaRestoreLegalActions(restoredAfterReplacement, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAfterReplacement, activateSeraph!);

    expect(restoredAfterReplacement.session.state.cards.find((card) => card.uid === number102.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: seraph.uid,
    });
    expect(restoredAfterReplacement.session.state.cards.find((card) => card.uid === seraph.uid)?.overlayUids).toEqual([]);

    const burnTrigger = getLuaRestoreLegalActions(restoredAfterReplacement, 0).find((action) => action.type === "activateTrigger");
    expect(burnTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAfterReplacement, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAfterReplacement, burnTrigger!);
    expect(restoredAfterReplacement.session.state.chain.flatMap((link) => link.operationInfos)).toEqual([]);
    resolveRestoredChain(restoredAfterReplacement);
    const restoredTarget = restoredAfterReplacement.session.state.cards.find((card) => card.uid === target.uid);
    expect(restoredTarget).toBeDefined();
    expect(currentAttack(restoredTarget, restoredAfterReplacement.session.state)).toBe(0);
    expect(isCardDisabled(restoredAfterReplacement.session.state, restoredTarget!, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredAfterReplacement.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredAfterReplacement.session.state.players[1].lifePoints).toBe(6500);
    expect(restoredAfterReplacement.session.state.eventHistory.filter((event) => ["detachedMaterial", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCardUid: extraMaterial.uid,
        eventCode: 1202,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: seraph.uid,
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
      {
        eventName: "detachedMaterial",
        eventCardUid: thirdMaterial.uid,
        eventCode: 1202,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: seraph.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "overlay",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 1,
        },
      },
      {
        eventName: "detachedMaterial",
        eventCardUid: extraMaterial.uid,
        eventCode: 1202,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: seraph.uid,
        eventReasonEffectId: 2,
        eventUids: [extraMaterial.uid, thirdMaterial.uid],
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
      {
        eventName: "detachedMaterial",
        eventCardUid: number102.uid,
        eventCode: 1202,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: seraph.uid,
        eventReasonEffectId: 4,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "overlay",
          position: "faceDown",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 2,
        },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: seraph.uid,
        eventReasonEffectId: 3,
      },
    ]);
    expect(restoredAfterReplacement.session.state.effects.filter((effect) => effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, event: "continuous", reset: { flags: 33427456 }, value: 0 },
      { code: 2, event: "continuous", reset: { flags: 33427456 }, value: undefined },
      { code: 8, event: "continuous", reset: { flags: 33427456 }, value: undefined },
    ]);
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const raw = getLuaRestoreLegalActions(restored, player);
  const grouped = getLuaRestoreLegalActionGroups(restored, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(raw);
  expect(result.legalActionGroups).toEqual(grouped);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
