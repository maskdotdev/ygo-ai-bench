import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSanganScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c26202165.lua"));

describe.skipIf(!hasUpstreamScripts || !hasSanganScript)("Lua real script Sangan same-code activation lock", () => {
  it("restores its searched-card same-code activation lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sanganCode = "26202165";
    const searchedCode = "26202166";
    const allowedCode = "26202167";
    const highAttackCode = "26202168";
    const spellDecoyCode = "26202169";
    const sanganScript = workspace.readScript(`c${sanganCode}.lua`);
    expect(sanganScript).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(sanganScript).toContain("e1:SetCode(EVENT_TO_GRAVE)");
    expect(sanganScript).toContain("e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
    expect(sanganScript).toContain("return c:IsAttackBelow(1500) and c:IsMonster() and c:IsAbleToHand()");
    expect(sanganScript).toContain("Duel.RegisterEffect(e1,tp)");
    expect(sanganScript).toContain("return re:GetHandler():IsCode(e:GetLabel())");
    const cards: DuelCardData[] = [
      { code: sanganCode, name: "Sangan", kind: "monster", typeFlags: 0x21, level: 3, attack: 1000, defense: 600 },
      { code: searchedCode, name: "Sangan Searched Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
      { code: allowedCode, name: "Sangan Different Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
      { code: highAttackCode, name: "Sangan High ATK Decoy", kind: "monster", typeFlags: 0x21, level: 4, attack: 1600, defense: 1000 },
      { code: spellDecoyCode, name: "Sangan Spell Decoy", kind: "spell", typeFlags: 0x2 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 262, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sanganCode, searchedCode, highAttackCode, spellDecoyCode, allowedCode] }, 1: { main: [] } });
    startDuel(session);

    const sangan = requireCard(session, sanganCode);
    const searched = requireCard(session, searchedCode);
    const allowed = requireCard(session, allowedCode);
    const highAttack = requireCard(session, highAttackCode);
    const spellDecoy = requireCard(session, spellDecoyCode);
    moveDuelCard(session.state, sangan.uid, "monsterZone", 0);
    sangan.position = "faceUpAttack";
    sangan.faceUp = true;
    moveDuelCard(session.state, allowed.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${searchedCode}.lua`) return responderScript("sangan searched responder resolved");
        if (name === `c${allowedCode}.lua`) return responderScript("sangan allowed responder resolved");
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sanganCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(searchedCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    sendDuelCardToGraveyard(session.state, sangan.uid, 0, duelReason.effect, 0);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === sangan.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === searched.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === highAttack.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === spellDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);
    expect(restoredLock.session.state.effects.find((effect) => effect.sourceUid === sangan.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
      luaValueDescriptor: "cannot-activate:same-code",
      label: Number(searchedCode),
    });
    restoredLock.session.state.phase = "main1";
    restoredLock.session.state.waitingFor = 0;
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === searched.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === allowed.uid)).toBe(true);
  });
});

function responderScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
