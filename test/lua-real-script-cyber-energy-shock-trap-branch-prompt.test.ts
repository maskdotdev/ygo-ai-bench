import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const cyberEnergyShockCode = "38265153";
const jinzoCode = "77585513";
const targetTrapCode = "382651530";
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cyber Energy Shock trap branch prompt", () => {
  it("restores trap destruction, optional SelectYesNo, SelectEffect branch prompt, and graveyard sends", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cyberEnergyShockCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_DISABLE+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.SelectTarget(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,c)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)>0 and istrap");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
    expect(script).toContain("local op=Duel.SelectEffect(tp,");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("tc:NegateEffects(c,RESET_PHASE|PHASE_END,true)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(800)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cyberEnergyShockCode || card.code === jinzoCode),
      { code: targetTrapCode, name: "Cyber Energy Shock Target Trap", kind: "trap", typeFlags: typeTrap },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 38265153, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cyberEnergyShockCode, jinzoCode, targetTrapCode] }, 1: { main: [] } });
    startDuel(session);

    const cyberEnergyShock = requireCard(session, cyberEnergyShockCode);
    const jinzo = requireCard(session, jinzoCode);
    const targetTrap = requireCard(session, targetTrapCode);
    const movedShock = moveDuelCard(session.state, cyberEnergyShock.uid, "spellTrapZone", 0);
    movedShock.position = "faceDown";
    movedShock.faceUp = false;
    movedShock.turnId = 0;
    const movedJinzo = moveDuelCard(session.state, jinzo.uid, "monsterZone", 0);
    movedJinzo.sequence = 4;
    movedJinzo.position = "faceUpAttack";
    movedJinzo.faceUp = true;
    const movedTrap = moveDuelCard(session.state, targetTrap.uid, "spellTrapZone", 0);
    movedTrap.sequence = 0;
    movedTrap.position = "faceDown";
    movedTrap.faceUp = false;
    session.state.phase = "main1";
    session.state.turn = 1;
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cyberEnergyShockCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === cyberEnergyShock.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);

    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 612242449, returned: true },
      { id: "lua-prompt-2", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [612242450, 612242451], returned: 1 },
    ]);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cyberEnergyShock.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === targetTrap.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: cyberEnergyShock.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: targetTrap.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: targetTrap.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: cyberEnergyShock.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: targetTrap.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: cyberEnergyShock.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: cyberEnergyShock.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
    ]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
  });
});

function requireCard(session: { state: { cards: DuelCardInstance[] } }, code: string): DuelCardInstance {
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
