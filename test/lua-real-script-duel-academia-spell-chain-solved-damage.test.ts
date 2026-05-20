import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const academyCode = "5833312";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAcademyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${academyCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const raceDinosaur = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAcademyScript)("Lua real script Duel Academy spell chain-solved damage", () => {
  it("restores Duel Academy's race-gated spell activation EVENT_CHAIN_SOLVED damage trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dinosaurCode = "5833313";
    const spellCode = "5833314";
    const script = workspace.readScript(`c${academyCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_DAMAGE)");
    expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVED)");
    expect(script).toContain("s.typecheck(RACE_DINOSAUR|RACE_SEASERPENT|RACE_THUNDER)");
    expect(script).toContain("re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:IsSpellEffect() and rp==tp");
    expect(script).toContain("re:GetHandler()~=c and not c:IsDisabled()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,1000)");
    expect(script).toContain("Duel.Damage(1-tp,1000,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === academyCode),
      { code: dinosaurCode, name: "Duel Academy Dinosaur Gate", kind: "monster", typeFlags: typeMonster, race: raceDinosaur, level: 4, attack: 1600, defense: 1200 },
      { code: spellCode, name: "Duel Academy Fixture Spell", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5833312, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [academyCode, dinosaurCode, spellCode] }, 1: { main: [] } });
    startDuel(session);

    const academy = requireCard(session, academyCode);
    const dinosaur = requireCard(session, dinosaurCode);
    const spell = requireCard(session, spellCode);
    const field = moveDuelCard(session.state, academy.uid, "spellTrapZone", 0);
    field.faceUp = true;
    field.position = "faceUpAttack";
    moveDuelCard(session.state, dinosaur.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, spell.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${spellCode}.lua`) return fixtureSpellScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(academyCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(spellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === spell.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.host.messages).toContain("duel academy fixture spell resolved");
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-5-1",
        effectId: "lua-3-1022",
        sourceUid: academy.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 5,
        eventTriggerTiming: "if",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === academy.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["chainSolved", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 5,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: academy.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-5",
        relatedEffectId: 3,
      },
    ]);

    const restoredAfterDamage = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredAfterDamage);
    expectRestoredLegalActions(restoredAfterDamage, 0);
    expect(restoredAfterDamage.session.state.players[1].lifePoints).toBe(7000);
  });
});

function fixtureSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("duel academy fixture spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
