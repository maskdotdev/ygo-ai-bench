import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fusion Conscription monster-effect lock", () => {
  it("restores searched-code summon, set, and monster-effect activation locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const conscriptionCode = "17194258";
    const fusionCode = "17194259";
    const searchedCode = "17194260";
    const allowedCode = "17194261";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === conscriptionCode),
      { code: fusionCode, name: "Fusion Conscription Listed Fusion", kind: "extra", typeFlags: 0x41, level: 6, attack: 2100, defense: 1600, fusionMaterials: [searchedCode] },
      { code: searchedCode, name: "Fusion Conscription Listed Monster", kind: "monster", typeFlags: 0x21, level: 4, attack: 1500, defense: 1200 },
      { code: allowedCode, name: "Fusion Conscription Other Monster", kind: "monster", typeFlags: 0x21, level: 4, attack: 1500, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 171, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [conscriptionCode, searchedCode, allowedCode], extra: [fusionCode] }, 1: { main: [] } });
    startDuel(session);

    const conscription = requireCard(session, conscriptionCode);
    const fusion = requireCard(session, fusionCode);
    const searched = requireCard(session, searchedCode);
    const allowed = requireCard(session, allowedCode);
    moveDuelCard(session.state, conscription.uid, "hand", 0);
    moveDuelCard(session.state, allowed.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${searchedCode}.lua`) return responderScript("fusion conscription searched responder resolved");
        if (name === `c${allowedCode}.lua`) return responderScript("fusion conscription allowed responder resolved");
        if (name === `c${fusionCode}.lua`) return fusionMaterialScript(searchedCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(conscriptionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(fusionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(searchedCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    const materialProbe = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,1,1,nil):GetFirst()
      Debug.Message("fusion conscription material probe " .. tostring(c and c.material and c.material[1]))
      Debug.Message("fusion conscription target probe " .. tostring(c17194258.filter1(c,0)))
      `,
      "fusion-conscription-material-probe.lua",
    );
    expect(materialProbe.ok, materialProbe.error).toBe(true);
    expect(host.messages).toContain(`fusion conscription material probe ${searchedCode}`);
    expect(host.messages).toContain("fusion conscription target probe true");

    const activate = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === conscription.uid);
    expect(activate, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    expect(applyResponse(session, activate!).ok).toBe(true);

    expect(session.state.cards.find((card) => card.uid === searched.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === fusion.uid)).toMatchObject({ location: "extraDeck", controller: 0 });

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    for (const code of [20, 22, 23]) {
      expect(restoredLock.session.state.effects.find((effect) => effect.sourceUid === conscription.uid && effect.code === code)).toMatchObject({
        event: "continuous",
        targetRange: [1, 0],
        luaTargetDescriptor: "target:same-code-label",
        label: Number(searchedCode),
      });
    }
    expect(restoredLock.session.state.effects.find((effect) => effect.sourceUid === conscription.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
      luaValueDescriptor: "cannot-activate:same-code-monster-effect",
      label: Number(searchedCode),
    });
    restoredLock.session.state.phase = "main1";
    restoredLock.session.state.waitingFor = 0;
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "normalSummon" && action.uid === searched.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "setMonster" && action.uid === searched.uid)).toBe(false);
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

function fusionMaterialScript(materialCode: string): string {
  return `
    local s,id=GetID()
    s.material={${materialCode}}
    function s.initial_effect(c)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
