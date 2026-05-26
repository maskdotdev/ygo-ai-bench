import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const blackfeatherCode = "60992105";
const hasBlackfeatherScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${blackfeatherCode}.lua`));
const damageSourceCode = "609921050";
const millMonsterCode = "609921051";
const millSpellCode = "609921052";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasBlackfeatherScript)("Lua real script Blackfeather damage deckdes ATK", () => {
  it("restores damage trigger into AnnounceNumberRange Deck send and operated-group ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${blackfeatherCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DECKDES+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCode(EVENT_DAMAGE)");
    expect(script).toContain("return ep==tp");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,tp,1)");
    expect(script).toContain("Duel.AnnounceNumberRange(tp,1,ct)");
    expect(script).toContain("Duel.DiscardDeck(tp,ac,REASON_EFFECT)");
    expect(script).toContain("local og=Duel.GetOperatedGroup()");
    expect(script).toContain("og:IsExists(s.monfilter,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(400)");

    const cards: DuelCardData[] = [
      { code: blackfeatherCode, name: "Blackfeather Darkrage Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, level: 8, attack: 2800, defense: 1600 },
      { code: damageSourceCode, name: "Blackfeather Fixture Damage Source", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: millMonsterCode, name: "Blackfeather Fixture Milled Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: millSpellCode, name: "Blackfeather Fixture Milled Spell", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 60992105, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [damageSourceCode, millMonsterCode, millSpellCode], extra: [blackfeatherCode] }, 1: { main: [] } });
    startDuel(session);

    const blackfeather = requireCard(session, blackfeatherCode);
    const damageSource = requireCard(session, damageSourceCode);
    const millMonster = requireCard(session, millMonsterCode);
    const millSpell = requireCard(session, millSpellCode);
    moveDuelCard(session.state, blackfeather.uid, "monsterZone", 0).position = "faceUpAttack";
    blackfeather.faceUp = true;
    blackfeather.summonType = "synchro";
    moveDuelCard(session.state, damageSource.uid, "monsterZone", 0).position = "faceUpAttack";
    damageSource.faceUp = true;
    millMonster.sequence = 0;
    millSpell.sequence = 1;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${damageSourceCode}.lua`) return damageSourceScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blackfeatherCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(damageSourceCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const damage = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === damageSource.uid);
    expect(damage, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, damage!);
    expect(restoredOpen.session.state.players[0]!.lifePoints).toBe(7500);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        player: 0,
        effectId: "lua-4-1111",
        sourceUid: blackfeather.uid,
        triggerBucket: "turnOptional",
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: damageSource.uid,
        eventReasonEffectId: 1,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === blackfeather.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "AnnounceNumberRange", player: 0, returned: 1 }),
    ]));
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === millMonster.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: blackfeather.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === millSpell.uid)).toMatchObject({ location: "deck" });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === blackfeather.uid), restoredTrigger.session.state)).toBe(3200);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["damageDealt", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: damageSource.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: millMonster.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: blackfeather.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function damageSourceScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp) Duel.Damage(tp,500,REASON_EFFECT) end)
      c:RegisterEffect(e)
    end
  `;
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
