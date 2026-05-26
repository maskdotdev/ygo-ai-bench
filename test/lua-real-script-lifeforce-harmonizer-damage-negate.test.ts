import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const harmonizerCode = "76214441";
const burnSpellCode = "762144410";
const followupCode = "762144411";
const hasHarmonizerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${harmonizerCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const racePsychic = 0x1000000;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasHarmonizerScript)("Lua real script Lifeforce Harmonizer damage negate", () => {
  it("restores hand SelfDiscard negation of a damage operation and suppresses the burn", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${harmonizerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 76214441, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [harmonizerCode, followupCode] }, 1: { main: [burnSpellCode] } });
    startDuel(session);

    const harmonizer = requireCard(session, harmonizerCode);
    const burnSpell = requireCard(session, burnSpellCode);
    const followup = requireCard(session, followupCode);
    moveDuelCard(session.state, harmonizer.uid, "hand", 0);
    moveDuelCard(session.state, followup.uid, "hand", 0);
    moveDuelCard(session.state, burnSpell.uid, "hand", 1);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${burnSpellCode}.lua`) return burnSpellScript();
        if (name === `c${followupCode}.lua`) return followupScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(harmonizerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(burnSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(followupCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const burnAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === burnSpell.uid);
    expect(burnAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, burnAction!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3-1002",
        sourceUid: burnSpell.uid,
        player: 1,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 1200 }],
      },
    ]);

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 0);
    const harmonizerAction = getLuaRestoreLegalActions(restoredOpenChain, 0).find((action) => action.type === "activateEffect" && action.uid === harmonizer.uid);
    expect(harmonizerAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenChain, harmonizerAction!);
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toMatchObject({
      effectId: "lua-1-1027",
      sourceUid: harmonizer.uid,
      operationInfos: [
        { category: 0x10000000, targetUids: [burnSpell.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [burnSpell.uid], count: 1, player: 0, parameter: 0 },
      ],
    });
    resolveRestoredChain(restoredOpenChain);
    expect(restoredOpenChain.session.state.chain).toHaveLength(0);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === harmonizer.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: harmonizer.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === burnSpell.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: harmonizer.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpenChain.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredOpenChain.host.messages).not.toContain("lifeforce burn resolved");
    expect(restoredOpenChain.host.messages).not.toContain("lifeforce followup resolved");
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
    ]);
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: harmonizerCode, name: "Lifeforce Harmonizer", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeLight, level: 2, attack: 800, defense: 400 },
    { code: burnSpellCode, name: "Lifeforce Fixture Burn Spell", kind: "spell", typeFlags: typeSpell },
    { code: followupCode, name: "Lifeforce Followup Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Lifeforce Harmonizer");
  expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("Duel.GetOperationInfo(ev,CATEGORY_DAMAGE)");
  expect(script).toContain("Duel.GetOperationInfo(ev,CATEGORY_RECOVER)");
  expect(script).toContain("Duel.IsPlayerAffectedByEffect(cp,EFFECT_REVERSE_RECOVER)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");
}

function burnSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DAMAGE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,1200)
      end)
      e:SetOperation(function(e,tp) Debug.Message("lifeforce burn resolved") Duel.Damage(1-tp,1200,REASON_EFFECT) end)
      c:RegisterEffect(e)
    end
  `;
}

function followupScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("lifeforce followup resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
