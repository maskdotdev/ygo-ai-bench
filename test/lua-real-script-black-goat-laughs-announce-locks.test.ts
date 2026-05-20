import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { isSpecialSummonPrevented } from "#duel/continuous-effects.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBlackGoatScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c49299410.lua"));

describe.skipIf(!hasUpstreamScripts || !hasBlackGoatScript)("Lua real script The Black Goat Laughs announce locks", () => {
  it("restores its announced same-code Special Summon lock except from the GY", () => {
    const setup = createBlackGoatSetup();
    const { session, source, reader, workspace, blackGoatCode, declaredCode, allowedCode } = setup;
    const blackGoatScript = workspace.readScript(`c${blackGoatCode}.lua`);
    expect(blackGoatScript).toContain("Duel.AnnounceCard(tp,TYPE_MONSTER,OPCODE_ISTYPE)");
    expect(blackGoatScript).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(blackGoatScript).toContain("c:IsOriginalCodeRule(code) and not c:IsLocation(LOCATION_GRAVE)");

    const blackGoat = requireCard(session, blackGoatCode);
    const declared = requireCard(session, declaredCode, 0);
    const allowed = requireCard(session, allowedCode, 0);
    moveDuelCard(session.state, blackGoat.uid, "spellTrapZone", 0);
    blackGoat.faceUp = false;
    blackGoat.position = "faceDown";
    moveDuelCard(session.state, declared.uid, "hand", 0);
    moveDuelCard(session.state, allowed.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blackGoatCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(declaredCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === blackGoat.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);

    expect(restored.host.promptDecisions).toContainEqual(expect.objectContaining({
      api: "AnnounceCard",
      player: 0,
      options: [Number(declaredCode), Number(allowedCode)],
      returned: Number(declaredCode),
    }));
    expect(restored.session.state.cards.find((card) => card.uid === blackGoat.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === blackGoat.uid && effect.code === 22)).toMatchObject({
      event: "continuous",
      targetRange: [1, 1],
      luaTargetDescriptor: "special-summon-limit:same-code-label-not-location:16",
      label: Number(declaredCode),
      reset: { flags: 0x40000200 },
    });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === declared.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === allowed.uid)).toBe(true);
    expect(isSpecialSummonPrevented(restoredLock.session.state, 0, createLuaMaterialCheckContext(restoredLock.session.state), declared)).toBe(true);
    const restoredEffect = restoredLock.session.state.effects.find((effect) => effect.sourceUid === blackGoat.uid && effect.code === 22);
    const restoredSource = restoredLock.session.state.cards.find((card) => card.uid === blackGoat.uid);
    expect(restoredEffect).toBeDefined();
    expect(restoredSource).toBeDefined();
    expect(restoredEffect!.targetCardPredicate!(createLuaMaterialCheckContext(restoredLock.session.state)(restoredEffect!, restoredSource!, declared), declared)).toBe(true);
    moveDuelCard(restoredLock.session.state, declared.uid, "graveyard", 0);
    const declaredInGrave = restoredLock.session.state.cards.find((card) => card.uid === declared.uid)!;
    expect(restoredEffect!.targetCardPredicate!(createLuaMaterialCheckContext(restoredLock.session.state)(restoredEffect!, restoredSource!, declaredInGrave), declaredInGrave)).toBe(false);
  });

  it("restores its grave self-banish announced on-field monster-effect activation lock", () => {
    const setup = createBlackGoatSetup();
    const { session, source, reader, workspace, blackGoatCode, declaredCode, allowedCode } = setup;
    const blackGoatScript = workspace.readScript(`c${blackGoatCode}.lua`);
    expect(blackGoatScript).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(blackGoatScript).toContain("e1:SetCode(EFFECT_CANNOT_ACTIVATE)");
    expect(blackGoatScript).toContain("_re:GetHandler():IsOriginalCodeRule(code) and _re:IsMonsterEffect() and _re:GetActivateLocation()==LOCATION_MZONE");

    const blackGoat = requireCard(session, blackGoatCode);
    const p0Declared = requireCard(session, declaredCode, 0);
    const p0Allowed = requireCard(session, allowedCode, 0);
    const p1Declared = requireCard(session, declaredCode, 1);
    const p1Allowed = requireCard(session, allowedCode, 1);
    moveDuelCard(session.state, blackGoat.uid, "graveyard", 0);
    moveFaceUpMonster(session, p0Declared.uid, 0);
    moveFaceUpMonster(session, p0Allowed.uid, 0);
    moveFaceUpMonster(session, p1Declared.uid, 1);
    moveFaceUpMonster(session, p1Allowed.uid, 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blackGoatCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(declaredCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === blackGoat.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);

    expect(restored.session.state.cards.find((card) => card.uid === blackGoat.uid)).toMatchObject({ location: "banished", controller: 0 });
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === blackGoat.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [1, 1],
      luaValueDescriptor: "cannot-activate:same-code-monster-effect-location:4",
      label: Number(declaredCode),
      reset: { flags: 0x40000200 },
    });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === p0Declared.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === p0Allowed.uid)).toBe(true);

    restoredLock.session.state.turnPlayer = 1;
    restoredLock.session.state.waitingFor = 1;
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === p1Declared.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 1).some((action) => action.type === "activateEffect" && action.uid === p1Allowed.uid)).toBe(true);
    expect(restoredLock.host.messages).not.toContain("black goat declared responder resolved");
  });
});

function createBlackGoatSetup() {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const blackGoatCode = "49299410";
  const declaredCode = "1000000";
  const allowedCode = "1000001";
  const cards: DuelCardData[] = [
    { code: blackGoatCode, name: "The Black Goat Laughs", kind: "trap", typeFlags: 0x4 },
    { code: declaredCode, name: "Black Goat Declared Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
    { code: allowedCode, name: "Black Goat Allowed Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 492, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [blackGoatCode, declaredCode, allowedCode] },
    1: { main: [declaredCode, allowedCode] },
  });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${declaredCode}.lua`) return responderScript("black goat declared responder resolved", declaredCode);
      if (name === `c${allowedCode}.lua`) return responderScript("black goat allowed responder resolved", allowedCode);
      return workspace.readScript(name);
    },
  };
  return { session, source, reader, workspace, blackGoatCode, declaredCode, allowedCode };
}

function responderScript(message: string, code: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_SPSUMMON_PROC)
      e:SetRange(LOCATION_HAND)
      e:SetValue(function(e,c) return c:IsCode(${code}) end)
      c:RegisterEffect(e)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_IGNITION)
      e2:SetRange(LOCATION_MZONE)
      e2:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e2)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string, controller = 0) {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === controller);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpMonster(session: ReturnType<typeof createDuel>, uid: string, controller: 0 | 1): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
