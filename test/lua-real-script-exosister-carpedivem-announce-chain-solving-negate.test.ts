import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const carpedivemCode = "30802207";
const exosisterXyzCode = "308022070";
const announcedSpellCode = "30802206";
const setExosister = 0x174;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Exosister Carpedivem announce chain-solving negate", () => {
  it("restores Xyz-summon AnnounceCard into same-original-code field disable and chain-solving negation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${carpedivemCode}.lua`);
    expect(script).toContain("Duel.AnnounceCard(tp)");
    expect(script).toContain("Duel.SetTargetParam(ac)");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
    expect(script).toContain("e2:SetLabel(ac)");
    expect(script).toContain("Duel.NegateEffect(ev)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === carpedivemCode),
      { code: exosisterXyzCode, name: "Carpedivem Fixture Exosister Xyz", kind: "monster", typeFlags: typeMonster | typeXyz, setcodes: [setExosister], level: 4, attack: 2000, defense: 800 },
      { code: announcedSpellCode, name: "Carpedivem Announced Spell", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 30802207, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [carpedivemCode, exosisterXyzCode, announcedSpellCode] }, 1: { main: [] } });
    startDuel(session);

    const carpedivem = requireCard(session, carpedivemCode);
    const exosisterXyz = requireCard(session, exosisterXyzCode);
    const announcedSpell = requireCard(session, announcedSpellCode);
    moveDuelCard(session.state, carpedivem.uid, "spellTrapZone", 0);
    carpedivem.faceUp = true;
    carpedivem.position = "faceUpAttack";
    moveDuelCard(session.state, exosisterXyz.uid, "hand", 0);
    moveDuelCard(session.state, announcedSpell.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${announcedSpellCode}.lua`) return announcedSpellScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(carpedivemCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(announcedSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    specialSummonDuelCard(session.state, exosisterXyz.uid, 0, 0, {}, luaSummonTypeXyz);
    expect(session.state.cards.find((card) => card.uid === exosisterXyz.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "xyz",
      summonTypeCode: luaSummonTypeXyz,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1102",
        sourceUid: carpedivem.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: exosisterXyz.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === carpedivem.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.host.promptDecisions).toContainEqual({
      id: "lua-prompt-1",
      api: "AnnounceCard",
      player: 0,
      options: [Number(announcedSpellCode), Number(carpedivemCode), Number(exosisterXyzCode)],
      descriptions: [Number(announcedSpellCode), Number(carpedivemCode), Number(exosisterXyzCode)],
      returned: Number(announcedSpellCode),
    });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === carpedivem.uid && [2, 1020].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      label: effect.label,
      reset: effect.reset,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
      luaConditionDescriptor: effect.luaConditionDescriptor,
    }))).toEqual([
      { code: 2, label: Number(announcedSpellCode), reset: { flags: 1073742336 }, targetRange: [12, 12], triggerEvent: undefined, luaConditionDescriptor: undefined },
      {
        code: 1020,
        label: Number(announcedSpellCode),
        reset: { flags: 1073742336 },
        targetRange: undefined,
        triggerEvent: "chainSolving",
        luaConditionDescriptor: "condition:chain-solving-effect-handler-original-code-label",
      },
    ]);

    const restoredDisable = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredDisable);
    expectRestoredLegalActions(restoredDisable, 0);
    expect(restoredDisable.session.state.effects.filter((effect) => effect.sourceUid === carpedivem.uid && [2, 1020].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      label: effect.label,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
      luaConditionDescriptor: effect.luaConditionDescriptor,
    }))).toEqual([
      { code: 2, label: Number(announcedSpellCode), targetRange: [12, 12], triggerEvent: undefined, luaConditionDescriptor: undefined },
      {
        code: 1020,
        label: Number(announcedSpellCode),
        targetRange: undefined,
        triggerEvent: "chainSolving",
        luaConditionDescriptor: "condition:chain-solving-effect-handler-original-code-label",
      },
    ]);

    const announcedActivation = getLuaRestoreLegalActions(restoredDisable, 0).find((action) => action.type === "activateEffect" && action.uid === announcedSpell.uid);
    expect(announcedActivation, JSON.stringify(getLuaRestoreLegalActions(restoredDisable, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDisable, announcedActivation!);
    expect(restoredDisable.host.messages).not.toContain("carpedivem announced spell resolved");
    expect(restoredDisable.session.state.chain).toEqual([]);
    expect(restoredDisable.session.state.eventHistory.filter((event) => event.eventName === "chainSolved")).toEqual([
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        relatedEffectId: 3,
      },
    ]);
  });
});

function announcedSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("carpedivem announced spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
