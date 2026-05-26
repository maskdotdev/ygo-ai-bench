import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const ravenCode = "47217354";
const hasRavenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ravenCode}.lua`));
const discardCode = "472173540";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const raceFiend = 0x8;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasRavenScript)("Lua real script Fabled Raven discard attack level stat", () => {
  it("restores hand-count discard into self ATK and Level updates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ravenCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_HANDES+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)>0");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,tp,1)");
    expect(script).toContain("Duel.DiscardHand(tp,aux.TRUE,1,60,REASON_EFFECT|REASON_DISCARD)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_LEVEL)");
    expect(script).toContain("e1:SetValue(ct*400)");
    expect(script).toContain("e2:SetValue(ct)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 47217354, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ravenCode, discardCode] }, 1: { main: [] } });
    startDuel(session);

    const raven = requireCard(session, ravenCode);
    const discard = requireCard(session, discardCode);
    moveFaceUpAttack(session, raven, 0);
    moveDuelCard(session.state, discard.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ravenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === raven.uid && action.effectId === "lua-1");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === raven.uid), restoredOpen.session.state)).toBe(1700);
    expect(currentLevel(restoredOpen.session.state.cards.find((card) => card.uid === raven.uid), restoredOpen.session.state)).toBe(3);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === raven.uid && (effect.code === 100 || effect.code === 130)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107235328 }, sourceUid: raven.uid, value: 400 },
      { code: 130, reset: { flags: 1107235328 }, sourceUid: raven.uid, value: 1 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === discard.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: discard.uid,
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: raven.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === raven.uid), restoredStat.session.state)).toBe(1700);
    expect(currentLevel(restoredStat.session.state.cards.find((card) => card.uid === raven.uid), restoredStat.session.state)).toBe(3);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: ravenCode, name: "Fabled Raven", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceFiend, attribute: attributeLight, level: 2, attack: 1300, defense: 1000 },
    { code: discardCode, name: "Fabled Raven Discard", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
