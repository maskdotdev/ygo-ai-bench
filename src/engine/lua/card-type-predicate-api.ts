import fengari from "fengari";
import { readCardUid } from "#lua/api-utils.js";
import { cardTypeFlags } from "#lua/card-stat-api.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardTypePredicateApi(L: unknown, session: DuelSession): void {
  pushBooleanGetter(L, "IsMonster", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x1) !== 0));
  pushBooleanGetter(L, "IsMonsterCard", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x1) !== 0));
  pushBooleanGetter(L, "IsNotTuner", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x1000) === 0));
  pushBooleanGetter(L, "IsSpell", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x2) !== 0));
  pushBooleanGetter(L, "IsSpellCard", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x2) !== 0));
  pushBooleanGetter(L, "IsTrap", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x4) !== 0));
  pushBooleanGetter(L, "IsSpellTrap", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x6) !== 0));
  pushBooleanGetter(L, "IsSpellTrapCard", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x6) !== 0));
  pushBooleanGetter(L, "IsSpirit", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x200000) !== 0));
  pushBooleanGetter(L, "IsActionCard", session, (card) => (cardTypeFlags(card, session.state) & 0x10000000) !== 0 && (cardTypeFlags(card, session.state) & 0x80000) === 0);
  pushBooleanGetter(L, "IsActionSpell", session, (card) => (cardTypeFlags(card, session.state) & 0x10000002) === 0x10000002 && (cardTypeFlags(card, session.state) & 0x80000) === 0);
  pushBooleanGetter(L, "IsActionTrap", session, (card) => (cardTypeFlags(card, session.state) & 0x10000004) === 0x10000004 && (cardTypeFlags(card, session.state) & 0x80000) === 0);
  pushBooleanGetter(L, "IsActionField", session, (card) => (cardTypeFlags(card, session.state) & 0x10080000) === 0x10080000);
  pushBooleanGetter(L, "IsEquipCard", session, (card) => Boolean(card && ((cardTypeFlags(card, session.state) & 0x40000) !== 0 || card.equippedToUid)));
  pushBooleanGetter(L, "IsEquipSpell", session, (card) => cardTypeFlags(card, session.state) === 0x40002);
  pushBooleanGetter(L, "IsEquipTrap", session, (card) => (cardTypeFlags(card, session.state) & 0x40004) === 0x40004);
  pushBooleanGetter(L, "IsFieldSpell", session, (card) => (cardTypeFlags(card, session.state) & 0x80002) === 0x80002);
  pushBooleanGetter(L, "IsLinkSpell", session, (card) => cardTypeFlags(card, session.state) === 0x4000002);
  pushBooleanGetter(L, "IsNormalSpell", session, (card) => cardTypeFlags(card, session.state) === 0x2);
  pushBooleanGetter(L, "IsNormalTrap", session, (card) => cardTypeFlags(card, session.state) === 0x4);
  pushBooleanGetter(L, "IsNormalSpellTrap", session, (card) => cardTypeFlags(card, session.state) === 0x2 || cardTypeFlags(card, session.state) === 0x4);
  pushBooleanGetter(L, "IsCounterTrap", session, (card) => (cardTypeFlags(card, session.state) & 0x100004) === 0x100004);
  pushBooleanGetter(L, "IsContinuousSpell", session, (card) => (cardTypeFlags(card, session.state) & 0x20002) === 0x20002);
  pushBooleanGetter(L, "IsRitualSpell", session, (card) => (cardTypeFlags(card, session.state) & 0x82) === 0x82);
  pushBooleanGetter(L, "IsContinuousTrap", session, (card) => (cardTypeFlags(card, session.state) & 0x20004) === 0x20004);
  pushBooleanGetter(L, "IsContinuousSpellTrap", session, (card) => (cardTypeFlags(card, session.state) & 0x20000) !== 0 && (cardTypeFlags(card, session.state) & 0x6) !== 0);
  pushBooleanGetter(L, "IsFusionMonster", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x41) === 0x41));
  pushBooleanGetter(L, "IsRitualMonster", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x81) === 0x81));
  pushBooleanGetter(L, "IsSynchroMonster", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x2001) === 0x2001));
  pushBooleanGetter(L, "IsXyzMonster", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x800001) === 0x800001));
  pushBooleanGetter(L, "IsPendulumMonster", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x1000001) === 0x1000001));
  pushBooleanGetter(L, "IsEffectMonster", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x21) === 0x21));
  pushBooleanGetter(L, "IsNonEffectMonster", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x1) !== 0 && (cardTypeFlags(card, session.state) & 0x20) === 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const card = readCard(state, session);
    const monsterType = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    if (card) {
      card.data.typeFlags = 0x1 | monsterType;
      const attribute = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : undefined;
      const race = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : undefined;
      const level = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : undefined;
      const attack = lua.lua_isnumber(state, 6) ? lua.lua_tointeger(state, 6) : undefined;
      const defense = lua.lua_isnumber(state, 7) ? lua.lua_tointeger(state, 7) : undefined;
      if (attribute !== undefined && attribute !== 0) card.data.attribute = attribute;
      if (race !== undefined && race !== 0) card.data.race = race;
      if (level !== undefined && level !== 0) card.data.level = level;
      if (attack !== undefined && attack !== 0) card.data.attack = attack;
      if (defense !== undefined && defense !== 0) card.data.defense = defense;
    }
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("AddMonsterAttribute"));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("AddMonsterAttributeComplete"));
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}
