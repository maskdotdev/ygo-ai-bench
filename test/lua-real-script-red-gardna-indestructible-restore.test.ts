import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Red Gardna indestructible restore", () => {
  it("restores Red Gardna's dynamic opponent-destruction protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const redGardnaCode = "72318602";
    const protectedCode = "72310";
    const starterCode = "72311";
    const destroyerCode = "72312";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === redGardnaCode),
      { code: protectedCode, name: "Red Dragon Protected Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 2500, defense: 2000, setcodes: [0x1045] },
      { code: starterCode, name: "Red Gardna Chain Starter", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: destroyerCode, name: "Red Gardna Destroy Probe", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 72318, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [redGardnaCode, protectedCode] }, 1: { main: [starterCode, destroyerCode] } });
    startDuel(session);

    const redGardna = session.state.cards.find((card) => card.code === redGardnaCode);
    const protectedMonster = session.state.cards.find((card) => card.code === protectedCode);
    const starter = session.state.cards.find((card) => card.code === starterCode);
    const destroyer = session.state.cards.find((card) => card.code === destroyerCode);
    expect(redGardna).toBeDefined();
    expect(protectedMonster).toBeDefined();
    expect(starter).toBeDefined();
    expect(destroyer).toBeDefined();
    moveDuelCard(session.state, redGardna!.uid, "hand", 0);
    moveDuelCard(session.state, starter!.uid, "hand", 1);
    moveDuelCard(session.state, destroyer!.uid, "hand", 1);
    const movedProtected = moveDuelCard(session.state, protectedMonster!.uid, "monsterZone", 0);
    movedProtected.faceUp = true;
    movedProtected.position = "faceUpAttack";
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return starterScript();
        if (name === `c${destroyerCode}.lua`) return destroyerScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(redGardnaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroyerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const startChain = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(startChain).toBeDefined();
    applyAndAssert(session, startChain!);
    expect(session.state.chain).toHaveLength(1);

    const protect = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === redGardna!.uid);
    expect(protect).toBeDefined();
    applyAndAssert(session, protect!);
    expect(session.state.cards.find((card) => card.uid === redGardna!.uid)).toMatchObject({ location: "graveyard" });
    passChainResponses(session);
    expect(host.messages).toContain("red gardna starter resolved");
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 41 && effect.sourceUid === redGardna!.uid)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 41,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-4-41",
        "lifePointValue": [Function],
        "luaTypeFlags": 2,
        "luaValueDescriptor": "indestructible:opponent",
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "promptOperation": [Function],
        "property": 256,
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:72318602:lua-4-41",
        "reset": {
          "flags": 1073742336,
        },
        "sourceUid": "p0-deck-72318602-0",
        "statValue": [Function],
        "target": [Function],
        "targetRange": [
          4,
          0,
        ],
        "valueCardPredicate": [Function],
        "valuePredicate": [Function],
      }
    `);

    const restoredProtected = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredProtected.restoreComplete, restoredProtected.incompleteReasons.join("; ")).toBe(true);
    expect(restoredProtected.missingRegistryKeys).toEqual([]);
    expect(restoredProtected.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredProtected.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 41 && effect.sourceUid === redGardna!.uid)).toMatchInlineSnapshot(`
      {
        "code": 41,
        "controller": 0,
        "event": "continuous",
        "id": "lua-4-41",
        "luaTypeFlags": 2,
        "luaValueDescriptor": "indestructible:opponent",
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "property": 256,
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:72318602:lua-4-41",
        "reset": {
          "flags": 1073742336,
        },
        "sourceUid": "p0-deck-72318602-0",
        "targetRange": [
          4,
          0,
        ],
        "valuePredicate": [Function],
      }
    `);

    expect(getLuaRestoreLegalActionGroups(restoredProtected, 1)).toEqual(getGroupedDuelLegalActions(restoredProtected.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredProtected, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredProtected, 1));
    const destroyAction = getLuaRestoreLegalActions(restoredProtected, 1).find((action) => action.type === "activateEffect" && action.uid === destroyer!.uid);
    expect(destroyAction).toBeDefined();
    if (!destroyAction || destroyAction.type !== "activateEffect") throw new Error("Expected Red Gardna destroy activation action");
    expect(restoredProtected.session.state.effects.find((effect) => effect.id === destroyAction.effectId)).toMatchObject({
      category: 0x1,
      range: ["hand"],
    });
    const destroyStarted = applyLuaRestoreResponse(restoredProtected, destroyAction);
    expect(destroyStarted.ok, destroyStarted.error).toBe(true);

    expect(restoredProtected.host.messages).toContain("red gardna destroy resolved 0");
    expect(restoredProtected.session.state.cards.find((card) => card.uid === protectedMonster!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    const ownDestroy = destroyDuelCard(restoredProtected.session.state, protectedMonster!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(ownDestroy).toMatchObject({ uid: protectedMonster!.uid, location: "graveyard" });
  });
});

function starterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("red gardna starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function destroyerScript(): string {
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
    function s.filter(c)
      return c:IsFaceup()
    end
    function s.tg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) and s.filter(chkc) end
      if chk==0 then return Duel.IsExistingTarget(s.filter,tp,0,LOCATION_MZONE,1,nil) end
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
      local g=Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)
      Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
    end
    function s.op(e,tp,eg,ep,ev,re,r,rp)
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) then
        Debug.Message("red gardna destroy resolved " .. Duel.Destroy(tc,REASON_EFFECT))
      end
    end
  `;
}

function passChainResponses(session: DuelSession): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, player));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
  return response;
}
