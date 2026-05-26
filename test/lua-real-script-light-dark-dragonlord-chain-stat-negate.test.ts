import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentAttribute, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const dragonlordCode = "19652159";
const hasDragonlordScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragonlordCode}.lua`));
const starterCode = "196521590";
const reviveDragonCode = "196521591";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDragonlordScript)("Lua real script Light and Darkness Dragonlord chain stat negate", () => {
  it("restores EVENT_CHAINING stat loss negation and destroyed Dragon revive targeting", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dragonlordCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,s.matfilter(ATTRIBUTE_LIGHT),s.matfilter(ATTRIBUTE_DARK))");
    expect(script).toContain("c:AddMustBeFusionSummoned()");
    expect(script).toContain("e1:SetCode(EFFECT_ADD_ATTRIBUTE)");
    expect(script).toContain("e1:SetValue(ATTRIBUTE_DARK)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE+CATEGORY_NEGATE)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_F)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
    expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
    expect(script).toContain("e2:SetCountLimit(1,0,EFFECT_COUNT_CODE_CHAIN)");
    expect(script).toContain("return re:IsHasType(EFFECT_TYPE_ACTIVATE) or re:IsMonsterEffect()");
    expect(script).toContain("c:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_NEGATE,eg,1,tp,0)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("Duel.GetCurrentChain()==ev+1");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("e3:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dragonlordCode),
      { code: starterCode, name: "Dragonlord Spell Activation Starter", kind: "spell", typeFlags: typeSpell },
      { code: reviveDragonCode, name: "Dragonlord Grave Revive Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 19652159, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [reviveDragonCode], extra: [dragonlordCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const dragonlord = requireCard(session, dragonlordCode);
    const starter = requireCard(session, starterCode);
    const reviveDragon = requireCard(session, reviveDragonCode);
    moveDuelCard(session.state, dragonlord.uid, "monsterZone", 0).position = "faceUpAttack";
    dragonlord.faceUp = true;
    dragonlord.summonType = "fusion";
    dragonlord.summonPlayer = 0;
    moveDuelCard(session.state, reviveDragon.uid, "graveyard", 0);
    moveDuelCard(session.state, starter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return spellStarterScript();
        const loaded = workspace.readScript(name);
        if (loaded === undefined) throw new Error(`Missing script ${name}`);
        return loaded;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dragonlordCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect((currentAttribute(dragonlord, session.state) & attributeDark) !== 0).toBe(true);

    const starterAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-6-1002",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 1, parameter: 1 }],
      },
    ]);

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 0);
    expect((currentAttribute(restoredOpenChain.session.state.cards.find((card) => card.uid === dragonlord.uid), restoredOpenChain.session.state) & attributeDark) !== 0).toBe(true);
    const negate = getLuaRestoreLegalActions(restoredOpenChain, 0).find((action) => action.type === "activateEffect" && action.uid === dragonlord.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenChain, negate!);
    expect(restoredOpenChain.session.state.chain).toEqual([]);
    expect(restoredOpenChain.host.messages).not.toContain("dragonlord starter resolved");
    expect(currentAttack(restoredOpenChain.session.state.cards.find((card) => card.uid === dragonlord.uid), restoredOpenChain.session.state)).toBe(2400);
    expect(currentDefense(restoredOpenChain.session.state.cards.find((card) => card.uid === dragonlord.uid), restoredOpenChain.session.state)).toBe(2000);
    expect(restoredOpenChain.session.state.effects.filter((effect) => effect.sourceUid === dragonlord.uid && [100, 104, 125].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: 125, property: 0x20000, range: ["monsterZone"], value: attributeDark },
      { code: 100, property: 0x2000, range: ["monsterZone"], value: -1000 },
      { code: 104, property: 0x2000, range: ["monsterZone"], value: -1000 },
    ]);
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 6,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 6,
      },
    ]);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === reviveDragon.uid)).toMatchObject({ location: "graveyard", controller: 0 });
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function spellStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("dragonlord starter resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}
