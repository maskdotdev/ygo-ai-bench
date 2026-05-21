import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { collectDuelTriggerEvent, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const kingCode = "49195710";
const genericMaterialCode = "491957100";
const djinnBusterCode = "3790062";
const triggerTargetCode = "491957101";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kingCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasKingScript)("Lua real script King Overfiend detach stat trigger lock", () => {
  it("restores detach target stat loss and overlay-gated opponent monster trigger lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${kingCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_DARK),3,3)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("tc:UpdateAttack(-1000,nil,c)");
    expect(script).toContain("tc:UpdateDefense(-1000,nil,c)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_TRIGGER)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
    expect(script).toContain("e:GetHandler():GetOverlayGroup():IsExists(Card.IsCode,1,nil,3790062)");

    const cards: DuelCardData[] = [
      { code: kingCode, name: "Number C65: King Overfiend", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, attribute: attributeDark, level: 3, attack: 1600, defense: 0 },
      { code: genericMaterialCode, name: "King Overfiend Generic Material", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeDark, level: 3, attack: 1000, defense: 1000 },
      { code: djinnBusterCode, name: "Number 65: Djinn Buster", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, attribute: attributeDark, level: 2, attack: 1300, defense: 0 },
      { code: triggerTargetCode, name: "King Overfiend Trigger-Locked Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 49195710, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [genericMaterialCode], extra: [kingCode, djinnBusterCode] }, 1: { main: [triggerTargetCode] } });
    startDuel(session);

    const king = requireCard(session, kingCode);
    const genericMaterial = requireCard(session, genericMaterialCode);
    const djinnBuster = requireCard(session, djinnBusterCode);
    const triggerTarget = requireCard(session, triggerTargetCode);
    moveFaceUpAttack(session, king, 0);
    moveDuelCard(session.state, genericMaterial.uid, "overlay", 0);
    moveDuelCard(session.state, djinnBuster.uid, "overlay", 0);
    king.overlayUids.push(genericMaterial.uid, djinnBuster.uid);
    moveFaceUpAttack(session, triggerTarget, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${triggerTargetCode}.lua`) return triggerProbeScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kingCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(triggerTargetCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const triggerLock = restoredOpen.session.state.effects.find((effect) => effect.sourceUid === king.uid && effect.code === 7);
    expect(triggerLock).toMatchObject({
      code: 7,
      event: "continuous",
      property: 0x80,
      range: ["monsterZone"],
      sourceUid: king.uid,
      targetRange: [0, 4],
    });

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === king.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === genericMaterial.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: king.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === king.uid)?.overlayUids).toEqual([djinnBuster.uid]);
    const restoredTarget = restoredOpen.session.state.cards.find((card) => card.uid === triggerTarget.uid)!;
    expect(currentAttack(restoredTarget, restoredOpen.session.state)).toBe(800);
    expect(currentDefense(restoredTarget, restoredOpen.session.state)).toBe(500);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === triggerTarget.uid && [100, 104].includes(effect.code ?? -1))).toEqual([]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial")).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: genericMaterial.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: king.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredLocked = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredLocked);
    collectDuelTriggerEvent(restoredLocked.session.state, "normalSummoned", restoredLocked.session.state.cards.find((card) => card.uid === king.uid));
    expect(restoredLocked.session.state.pendingTriggers).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredLocked, 1).some((action) => action.type === "activateTrigger" && action.uid === triggerTarget.uid)).toBe(false);
    expect(restoredLocked.host.messages).not.toContain("king overfiend locked trigger resolved");
  });
});

function triggerProbeScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_SUMMON_SUCCESS)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        Debug.Message("king overfiend locked trigger resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
