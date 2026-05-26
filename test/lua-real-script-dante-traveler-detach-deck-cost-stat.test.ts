import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const danteCode = "83531441";
const materialCode = "835314410";
const costCodes = ["835314411", "835314412", "835314413"] as const;
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDanteScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${danteCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const attributeLight = 0x10;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDanteScript)("Lua real script Dante Traveler detach deck cost stat", () => {
  it("restores detach plus AnnounceNumberRange deck-send cost into ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${danteCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 83531441, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, ...costCodes], extra: [danteCode] }, 1: { main: [] } });
    startDuel(session);

    const dante = requireCard(session, danteCode);
    const material = requireCard(session, materialCode);
    const costs = costCodes.map((code) => requireCard(session, code));
    moveFaceUpAttack(session, dante, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 0;
    dante.overlayUids.push(material.uid);
    costs.forEach((card, index) => {
      card.location = "deck";
      card.controller = 0;
      card.sequence = index;
    });
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const promptOverrides = [{ api: "AnnounceNumberRange" as const, player: 0 as const, returned: 3 }];
    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(danteCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === dante.uid && candidate.effectId === "lua-2"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);

    expect(restored.host.promptDecisions.map((decision) => ({
      api: decision.api,
      options: "options" in decision ? decision.options : undefined,
      player: decision.player,
      returned: decision.returned,
    }))).toEqual([{ api: "AnnounceNumberRange", options: [1, 2, 3], player: 0, returned: 1 }]);
    expect(findCard(restored.session, dante.uid).overlayUids).toEqual([]);
    expect(findCard(restored.session, material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: dante.uid,
      reasonEffectId: 2,
    });
    expect(costs.map((card) => findCard(restored.session, card.uid)).map((card) => ({
      location: card.location,
      reason: card.reason,
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
      reasonPlayer: card.reasonPlayer,
    }))).toEqual([
      { location: "graveyard", reason: duelReason.cost, reasonCardUid: dante.uid, reasonEffectId: 2, reasonPlayer: 0 },
      { location: "deck", reason: undefined, reasonCardUid: undefined, reasonEffectId: undefined, reasonPlayer: undefined },
      { location: "deck", reason: undefined, reasonCardUid: undefined, reasonEffectId: undefined, reasonPlayer: undefined },
    ]);
    expect(currentAttack(findCard(restored.session, dante.uid), restored.session.state)).toBe(1500);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === dante.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: dante.uid, value: 500 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) =>
      ["detachedMaterial", "sentToGraveyard"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: material.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: dante.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: material.uid, eventCode: 1202, eventName: "detachedMaterial", eventReason: duelReason.cost, eventReasonCardUid: dante.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: costs[0]!.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: dante.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const dante = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === danteCode);
  expect(dante).toBeDefined();
  return [
    dante!,
    { code: materialCode, name: "Dante Traveler Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeLight, level: 3, attack: 1000, defense: 1000 },
    ...costCodes.map((code, index) => ({ code, name: `Dante Traveler Deck Cost ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeLight, level: 3, attack: 1000, defense: 1000 })),
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Dante, Traveler of the Burning Abyss");
  expect(script).toContain("Xyz.AddProcedure(c,nil,3,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCost(Cost.AND(Cost.DetachFromSelf(1),s.atkcost))");
  expect(script).toContain("Duel.IsPlayerCanDiscardDeckAsCost(tp,1)");
  expect(script).toContain("Duel.AnnounceNumberRange(tp,1,max_ct)");
  expect(script).toContain("Duel.DiscardDeck(tp,op,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel()*500)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
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
