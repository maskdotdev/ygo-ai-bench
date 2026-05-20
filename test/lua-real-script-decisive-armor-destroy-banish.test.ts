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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const decisiveArmorCode = "88240999";
const hasDecisiveArmorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${decisiveArmorCode}.lua`));
const facedownCode = "882409990";
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDecisiveArmorScript)("Lua real script Decisive Armor destroy banish", () => {
  it("restores facedown target destruction redirected to banished", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${decisiveArmorCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e2:SetRange(LOCATION_HAND)");
    expect(script).toContain("e2:SetCost(Cost.SelfDiscard)");
    expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("e3:SetCategory(CATEGORY_DESTROY+CATEGORY_REMOVE)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e3:SetRange(LOCATION_MZONE)");
    expect(script).toContain("return c:IsFacedown() and c:IsAbleToRemove()");
    expect(script).toContain("Duel.SelectTarget(tp,s.desfilter,tp,0,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,1,0,0)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT,LOCATION_REMOVED)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === decisiveArmorCode),
      { code: facedownCode, name: "Decisive Armor Facedown Target", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 88240999, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [decisiveArmorCode] }, 1: { main: [facedownCode] } });
    startDuel(session);

    const decisiveArmor = requireCard(session, decisiveArmorCode);
    const facedown = requireCard(session, facedownCode);
    moveDuelCard(session.state, decisiveArmor.uid, "monsterZone", 0).position = "faceUpAttack";
    decisiveArmor.faceUp = true;
    moveDuelCard(session.state, facedown.uid, "spellTrapZone", 1).position = "faceDown";
    facedown.faceUp = false;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(decisiveArmorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === decisiveArmor.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === facedown.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: decisiveArmor.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "banished"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: facedown.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        relatedEffectId: 4,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: facedown.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: decisiveArmor.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 1, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: facedown.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: decisiveArmor.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 1, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
  });
});

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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
