import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const fifinellagCode = "12977245";
const protectedAltergeistCode = "129772450";
const openTargetCode = "129772451";
const attackerCode = "129772452";
const targeterCode = "129772453";
const setAltergeist = 0x103;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Altergeist Fifinellag target protection", () => {
  it("restores Altergeist battle-target and opponent effect-target protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${fifinellagCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
    expect(script).toContain("e2:SetValue(aux.tgoval)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_ALTERGEIST) and not c:IsCode(id)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fifinellagCode),
      { code: protectedAltergeistCode, name: "Fifinellag Protected Altergeist", kind: "monster", typeFlags: 0x1, setcodes: [setAltergeist], level: 4, attack: 1500, defense: 1000 },
      { code: openTargetCode, name: "Fifinellag Open Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      { code: attackerCode, name: "Fifinellag Fixture Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: targeterCode, name: "Fifinellag Fixture Targeter", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${targeterCode}.lua`) return targetingDestroyerScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 12977245, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fifinellagCode, protectedAltergeistCode, openTargetCode] }, 1: { main: [attackerCode, targeterCode] } });
    startDuel(session);

    const fifinellag = requireCard(session, fifinellagCode);
    const protectedAltergeist = requireCard(session, protectedAltergeistCode);
    const openTarget = requireCard(session, openTargetCode);
    const attacker = requireCard(session, attackerCode);
    const targeter = requireCard(session, targeterCode);
    moveFaceUpAttack(session, fifinellag, 0);
    moveFaceUpAttack(session, protectedAltergeist, 0);
    moveFaceUpAttack(session, openTarget, 0);
    moveFaceUpAttack(session, attacker, 1);
    moveDuelCard(session.state, targeter.uid, "hand", 1);
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fifinellagCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(targeterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.find((effect) => effect.sourceUid === fifinellag.uid && effect.code === 332)).toMatchObject({
      event: "continuous",
      range: ["monsterZone"],
      targetRange: [0, 4],
    });
    expect(session.state.effects.find((effect) => effect.sourceUid === fifinellag.uid && effect.code === 71)).toMatchObject({
      event: "continuous",
      property: 0x80,
      range: ["monsterZone"],
      targetRange: [4, 0],
    });

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 1);
    expect(hasAttack(battleActions, attacker.uid, protectedAltergeist.uid)).toBe(false);
    expect(hasAttack(battleActions, attacker.uid, openTarget.uid)).toBe(true);

    restoredBattle.session.state.phase = "main1";
    const restoredTargeting = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredTargeting);
    expectRestoredLegalActions(restoredTargeting, 1);
    expect(restoredTargeting.host.loadScript(effectTargetProbe(fifinellagCode, protectedAltergeistCode, openTargetCode, targeterCode), "fifinellag-effect-target-probe.lua").ok).toBe(true);
    expect(restoredTargeting.host.messages).toContain("fifinellag effect targets false/true");
    const targetAction = getLuaRestoreLegalActions(restoredTargeting, 1).find((action) => action.type === "activateEffect" && action.uid === targeter.uid);
    expect(targetAction, JSON.stringify(getLuaRestoreLegalActions(restoredTargeting, 1), null, 2)).toBeDefined();
    expect(targetAction).toMatchObject({ type: "activateEffect", uid: targeter.uid });
    applyLuaRestoreAndAssert(restoredTargeting, targetAction!);
    expect(restoredTargeting.host.messages).toContain("fifinellag targeter destroyed 1");
    expect(restoredTargeting.session.state.cards.find((card) => card.uid === protectedAltergeist.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
  });
});

function targetingDestroyerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(s.tg)
      e:SetOperation(s.op)
      c:RegisterEffect(e)
    end
    function s.filter(c,e)
      return c:IsFaceup() and c:IsCanBeEffectTarget(e)
    end
    function s.tg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) and s.filter(chkc,e) end
      if chk==0 then return Duel.IsExistingTarget(s.filter,tp,0,LOCATION_MZONE,1,nil,e) end
      local g=Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil,e)
      Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
    end
    function s.op(e,tp,eg,ep,ev,re,r,rp)
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) then
        Debug.Message("fifinellag targeter destroyed " .. Duel.Destroy(tc,REASON_EFFECT))
      end
    end
  `;
}

function effectTargetProbe(handlerCode: string, protectedCode: string, openCode: string, targeterCodeValue: string): string {
  return `
    local handler=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${handlerCode}),0,LOCATION_MZONE,0,nil)
    local protected_target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${protectedCode}),0,LOCATION_MZONE,0,nil)
    local open_target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${openCode}),0,LOCATION_MZONE,0,nil)
    local targeter=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targeterCodeValue}),1,LOCATION_HAND,0,nil)
    local opponent_effect=Effect.CreateEffect(targeter)
    Debug.Message("fifinellag effect targets " .. tostring(protected_target:IsCanBeEffectTarget(opponent_effect)) .. "/" .. tostring(open_target:IsCanBeEffectTarget(opponent_effect)))
    Debug.Message("fifinellag handler present " .. tostring(handler~=nil))
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
